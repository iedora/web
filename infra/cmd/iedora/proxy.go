package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// dnsOverrideProxy is an HTTP CONNECT (and forward-HTTP) proxy that lives on
// localhost and dials a fixed IP for any host in `overrides`. Everything
// else routes via the system resolver.
//
// Why this exists: the zitadel Terraform provider talks to the upstream
// (auth.iedora.com) using Go's HTTP + gRPC stacks. Both honor
// HTTPS_PROXY / HTTP_PROXY env vars by issuing an HTTP CONNECT to the
// proxy and letting the proxy do the DNS. By pointing them at this
// proxy and pinning auth.iedora.com → fresh Hetzner IPv4 in the
// override map, we bypass the operator's local resolver entirely —
// no sudo, no /etc/hosts edit, no `dscacheutil -flushcache`. Works
// identically in CI (where the macOS NXDOMAIN cache doesn't exist but
// the env shape stays the same — so we don't need a CI-only codepath).
//
// References:
//   - net/http docs §http.ProxyFromEnvironment (HTTPS_PROXY semantics)
//   - grpc-go internal/transport/http2_client.go — picks up HTTPS_PROXY
//     for the dial step (HTTP CONNECT through the proxy before HTTP/2
//     stream init).
type dnsOverrideProxy struct {
	overrides map[string]string // "auth.iedora.com:443" → "46.224.162.208:443"
	server    *http.Server
	listener  net.Listener
	mu        sync.Mutex
}

func newDNSOverrideProxy(overrides map[string]string) *dnsOverrideProxy {
	return &dnsOverrideProxy{overrides: overrides}
}

// Start begins listening on a random localhost port. Returns the URL the
// proxy is reachable at (e.g. http://127.0.0.1:54321) — caller exports it
// as HTTPS_PROXY / HTTP_PROXY for the child tofu process. The proxy runs
// until Stop() is called or the context cancels.
func (p *dnsOverrideProxy) Start(ctx context.Context) (string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("listen: %w", err)
	}
	p.listener = ln

	// CONNECT requests have a request-URI of `host:port` (no leading
	// slash), so http.ServeMux can't route them — use the handler
	// function directly as the server's top-level Handler.
	server := &http.Server{
		Handler:           http.HandlerFunc(p.handle),
		ReadHeaderTimeout: 10 * time.Second, // CONNECT tunnels themselves can be long-lived
	}
	p.server = server

	go func() {
		// Capture the server in a local before the goroutine starts so a
		// concurrent Stop() (which nils p.server) can't race us into a
		// nil-pointer Serve call.
		_ = server.Serve(ln)
	}()
	go func() {
		<-ctx.Done()
		p.Stop()
	}()

	return "http://" + ln.Addr().String(), nil
}

func (p *dnsOverrideProxy) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.server != nil {
		_ = p.server.Close()
		p.server = nil
	}
}

func (p *dnsOverrideProxy) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		p.handleConnect(w, r)
		return
	}
	p.handleHTTP(w, r)
}

// handleConnect is the only case zitadel/Tofu actually exercises in
// practice (HTTPS_PROXY + outbound HTTPS == CONNECT tunnel). The forward-
// HTTP path below is there for completeness so the proxy doesn't fail on
// random plain-HTTP probes (eg. tofu provider plugin checks).
func (p *dnsOverrideProxy) handleConnect(w http.ResponseWriter, r *http.Request) {
	target := p.rewrite(r.Host)

	upstream, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		http.Error(w, "upstream dial: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer upstream.Close()

	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	client, bufrw, err := hj.Hijack()
	if err != nil {
		http.Error(w, "hijack: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer client.Close()

	// Tell the client the tunnel is open. Some clients send the first
	// byte the moment they see "200 OK"; flush before piping.
	if _, err := bufrw.WriteString("HTTP/1.1 200 OK\r\n\r\n"); err != nil {
		return
	}
	_ = bufrw.Flush()

	// Bi-directional pipe. Close one side when the other returns EOF —
	// Tofu finishes the OIDC discovery then closes; gRPC streams may
	// stay open for the full plan/apply (and that's fine).
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(upstream, client); done <- struct{}{} }()
	go func() { _, _ = io.Copy(client, upstream); done <- struct{}{} }()
	<-done
}

func (p *dnsOverrideProxy) handleHTTP(w http.ResponseWriter, r *http.Request) {
	// Tofu and the zitadel provider always use HTTPS for the upstream, so
	// HTTPS_PROXY routes through CONNECT (handleConnect). Forward-HTTP is
	// only worth implementing if a caller starts probing http:// URLs
	// through the proxy — none of our consumers do today. Be loud rather
	// than wrong if someone unexpectedly takes this path.
	http.Error(w, "forward-HTTP path not exercised by Tofu — open a CONNECT tunnel", http.StatusNotImplemented)
}

// rewrite returns the addr to actually dial. If hostport matches an
// override (case-insensitive on the hostname), the override is returned.
// Otherwise hostport is returned unchanged. Ports are matched literally
// — overriding only :443 (the only port the zitadel provider uses) is
// fine because nothing else dials :80 or :8443 to auth.iedora.com.
func (p *dnsOverrideProxy) rewrite(hostport string) string {
	if hostport == "" {
		return hostport
	}
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		// CONNECT clients always include the port; defensive only.
		host = hostport
		port = "443"
	}
	key := strings.ToLower(host) + ":" + port
	if target, ok := p.overrides[key]; ok {
		return target
	}
	// Also accept just-the-hostname form in the override map.
	if target, ok := p.overrides[strings.ToLower(host)]; ok {
		return target
	}
	return hostport
}
