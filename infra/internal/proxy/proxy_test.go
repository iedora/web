package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/eduvhc/iedora/infra/internal/testfakes"
)

// TestRewrite — the central correctness property. An override map keyed
// by "host:port" must redirect that exact pair to the override target,
// while leaving every other host:port alone.
func TestRewrite(t *testing.T) {
	p := New(DNSOverride{
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
		if got := p.Rewrite(c.in); got != c.want {
			t.Errorf("Rewrite(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestConnectTunnel — end-to-end: stand up a local "fake upstream" HTTPS
// server, point the proxy at its concrete loopback IP via the override
// map, then drive an HTTPS request from a Go HTTP client configured to
// use the proxy. The request must reach the upstream even though the
// hostname in the request (auth.iedora.invalid) does not resolve via
// the system resolver.
func TestConnectTunnel(t *testing.T) {
	cert, err := testfakes.MintCert("auth.iedora.invalid")
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

	upstreamAddr := upstreamLn.Addr().String()
	p := New(DNSOverride{"auth.iedora.invalid:443": upstreamAddr})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	proxyURL, err := p.Start(ctx)
	if err != nil {
		t.Fatalf("start proxy: %v", err)
	}
	defer p.Stop()

	proxyParsed, _ := url.Parse(proxyURL)
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyParsed),
			TLSClientConfig: &tls.Config{
				ServerName:         "auth.iedora.invalid",
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

// TestStopIdempotent — Stop() may be called multiple times safely
// (deferred in callers).
func TestStopIdempotent(t *testing.T) {
	p := New(nil)
	if _, err := p.Start(t.Context()); err != nil {
		t.Fatalf("start: %v", err)
	}
	p.Stop()
	p.Stop()
}
