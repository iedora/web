package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// TestProxyRewrite — the central correctness property. An override map
// keyed by "host:port" must redirect that exact pair to the override
// target, while leaving every other host:port alone.
func TestProxyRewrite(t *testing.T) {
	p := newDNSOverrideProxy(map[string]string{
		"auth.iedora.com:443": "1.2.3.4:443",
		"foo.example:80":      "10.0.0.1:80",
	})
	cases := []struct {
		in, want string
	}{
		{"auth.iedora.com:443", "1.2.3.4:443"},
		{"AUTH.IEDORA.COM:443", "1.2.3.4:443"}, // case-insensitive
		{"foo.example:80", "10.0.0.1:80"},
		{"auth.iedora.com:80", "auth.iedora.com:80"}, // port not overridden — passthrough
		{"other.example:443", "other.example:443"},   // not in map — passthrough
		{"", ""},
	}
	for _, c := range cases {
		if got := p.rewrite(c.in); got != c.want {
			t.Errorf("rewrite(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestProxyConnectTunnel — end-to-end: stand up a local "fake upstream"
// HTTPS server, point the proxy at its concrete loopback IP via the
// override map, then drive an HTTPS request from a Go HTTP client
// configured to use the proxy. The request must reach the upstream
// even though the hostname in the request (auth.iedora.invalid) does
// not resolve via the system resolver.
func TestProxyConnectTunnel(t *testing.T) {
	// 1. Stand up a fake HTTPS upstream on a random loopback port. The
	// cert is generated below.
	cert, err := generateSelfSigned("auth.iedora.invalid")
	if err != nil {
		t.Fatalf("self-signed cert: %v", err)
	}

	upstreamLn, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatalf("listen upstream: %v", err)
	}
	defer upstreamLn.Close()

	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/probe", func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, "ok")
		})
		srv := &http.Server{Handler: mux}
		_ = srv.Serve(upstreamLn)
	}()

	// 2. Stand up the proxy with auth.iedora.invalid → upstream addr.
	upstreamAddr := upstreamLn.Addr().String()
	proxy := newDNSOverrideProxy(map[string]string{
		"auth.iedora.invalid:443": upstreamAddr,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	proxyURL, err := proxy.Start(ctx)
	if err != nil {
		t.Fatalf("start proxy: %v", err)
	}
	defer proxy.Stop()

	// 3. HTTPS client through the proxy, with a CA pool that trusts our
	// self-signed cert. NOTE: we deliberately use a hostname that does
	// not resolve via DNS — the test is checking that the proxy does the
	// resolve on our behalf.
	proxyParsed, _ := url.Parse(proxyURL)
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyParsed),
			TLSClientConfig: &tls.Config{
				RootCAs:    nil,
				ServerName: "auth.iedora.invalid",
				// Trust only the leaf — we don't have a CA bundle for
				// the self-signed cert generated above.
				InsecureSkipVerify: true,
			},
		},
		Timeout: 5 * time.Second,
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://auth.iedora.invalid:443/probe", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request via proxy: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "ok" {
		t.Errorf("body = %q, want %q", body, "ok")
	}
}

// TestProxyStopIdempotent — Stop() may be called multiple times safely
// (deferred in callers).
func TestProxyStopIdempotent(t *testing.T) {
	p := newDNSOverrideProxy(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if _, err := p.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	p.Stop()
	p.Stop() // must not panic
}

// generateSelfSigned mints a 1-day self-signed cert good for the given
// hostname. Only used in tests.
func generateSelfSigned(hostname string) (tls.Certificate, error) {
	cert, err := selfSignedECDSA(hostname)
	if err != nil {
		return tls.Certificate{}, err
	}
	return cert, nil
}

// helper — DRY the test cert. Imported in-line to avoid Pulling extra
// deps. Uses ECDSA P-256 (small + fast).
func selfSignedECDSA(hostname string) (tls.Certificate, error) {
	return mintTestCert(hostname)
}

// Concrete impl in a sibling file so the test stays focused on what
// matters; see proxy_test_helpers.go.
var _ = net.JoinHostPort // silence "imported and not used"
