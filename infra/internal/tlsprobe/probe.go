// Package tlsprobe is the deploy-readiness gate for Zitadel/Caddy on the
// fresh Hetzner box: HTTP /debug/ready + a leaf-cert issuer check that
// distinguishes real Let's Encrypt from Caddy's internal CA.
package tlsprobe

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// Logger is where Wait prints retry chatter. Defaults to os.Stderr; tests
// can redirect.
var Logger io.Writer = os.Stderr

// Target is the state required before the zitadel TF provider can run a
// successful plan/apply. Two preconditions:
//
//  1. /debug/ready returns 200 (Zitadel's FirstInstance step finished).
//  2. The served TLS cert is real Let's Encrypt — NOT Caddy's internal
//     CA. Caddy serves the internal CA cert during ACME's TLS-ALPN-01
//     challenge window (typically 30-60s after Caddy boots). The TF
//     provider's Go HTTP client rejects the internal CA → OIDC
//     discovery fails. An older wait loop only checked #1 and exited
//     too early, which is what motivated the second probe.
//
// Both checks dial via the FRESH Hetzner IP, NOT through the operator's
// system resolver — that's the whole reason for the IPv4 arg. Using
// the IP also makes this work in CI immediately after Pass 1 (before
// any DNS propagates).
type Target struct {
	Hostname string // e.g. "auth.iedora.com"
	IPv4     string // e.g. "46.224.162.208"
	Port     string // empty == "443" (production). Tests override to a random port.
}

func (t Target) port() string {
	if t.Port == "" {
		return "443"
	}
	return t.Port
}

// Wait polls until both preconditions hold or budget is exhausted.
// Returns the elapsed time on success.
func Wait(ctx context.Context, t Target, budget time.Duration) (time.Duration, error) {
	start := time.Now()
	deadline := start.Add(budget)

	var lastErr error
	for time.Now().Before(deadline) {
		// Stage 1: /debug/ready 200. Cheap, fast — if Zitadel isn't even
		// listening we don't bother checking the cert.
		if err := ProbeReady(ctx, t); err != nil {
			lastErr = err
			fmt.Fprintf(Logger, "  /debug/ready: %v — retry\n", err)
			sleep(ctx, 2*time.Second)
			continue
		}
		// Stage 2: real LE cert? Caddy may still be serving the internal
		// CA. We treat that as "not ready yet" — the cert state will
		// flip atomically the moment ACME's challenge succeeds, no
		// half-way state to worry about.
		issuer, err := ProbeCertIssuer(ctx, t)
		if err != nil {
			lastErr = err
			fmt.Fprintf(Logger, "  cert probe: %v — retry\n", err)
			sleep(ctx, 2*time.Second)
			continue
		}
		if !IssuerIsTrusted(issuer) {
			lastErr = fmt.Errorf("cert issuer still internal CA (%q) — waiting for Let's Encrypt", issuer)
			fmt.Fprintf(Logger, "  %v\n", lastErr)
			sleep(ctx, 2*time.Second)
			continue
		}
		return time.Since(start), nil
	}

	if lastErr == nil {
		lastErr = errors.New("budget exhausted with no probe attempts (clock weirdness?)")
	}
	return time.Since(start), fmt.Errorf("timed out after %s: %w", budget, lastErr)
}

// ProbeReady issues an HTTPS GET /debug/ready against the IP, with SNI +
// Host header set to Hostname. Uses a dedicated dialer that ignores the
// system resolver so we can probe a not-yet-DNS-propagated hostname.
//
// Note: this DOES validate the TLS chain (no InsecureSkipVerify) — if
// Caddy is still serving its internal CA, this call will return a TLS
// verification error, which is exactly the signal ProbeCertIssuer
// interprets too. The two stages are written independently so the
// failure mode is obvious in logs.
func ProbeReady(ctx context.Context, t Target) error {
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			// Pin the dial to t.IPv4:443 regardless of what the system
			// resolver returns for Hostname (it may NXDOMAIN-cache it).
			// SNI + Host header still go as Hostname so Caddy's site
			// matcher routes correctly.
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(t.IPv4, t.port()))
			},
			TLSClientConfig: &tls.Config{ServerName: t.Hostname},
		},
	}
	defer client.CloseIdleConnections()

	url := "https://" + t.Hostname + "/debug/ready"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("got HTTP %d (want 200)", resp.StatusCode)
	}
	return nil
}

// ProbeCertIssuer opens a TLS handshake to t.IPv4:port with SNI=Hostname
// and returns the issuer of the leaf cert. Skips chain verification on
// purpose — we want to see what Caddy is serving regardless of whether
// our system trust store accepts it.
func ProbeCertIssuer(ctx context.Context, t Target) (string, error) {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	rawConn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(t.IPv4, t.port()))
	if err != nil {
		return "", err
	}
	defer rawConn.Close()

	conn := tls.Client(rawConn, &tls.Config{
		ServerName:         t.Hostname,
		InsecureSkipVerify: true, // we read the cert regardless of trust
	})
	if err := conn.HandshakeContext(ctx); err != nil {
		return "", err
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return "", errors.New("no peer certificates")
	}
	leaf := state.PeerCertificates[0]
	return issuerString(leaf), nil
}

func issuerString(c *x509.Certificate) string {
	return c.Issuer.String()
}

// IssuerIsTrusted returns true if the issuer string looks like a public
// CA. We explicitly REJECT "Caddy Local Authority" (Caddy mid-ACME);
// anything else is accepted (permissive — a future ACME issuer swap
// won't need a code edit).
func IssuerIsTrusted(issuer string) bool {
	lower := strings.ToLower(issuer)
	if strings.Contains(lower, "caddy local authority") {
		return false
	}
	if strings.Contains(lower, "let's encrypt") || strings.Contains(lower, "lets encrypt") {
		return true
	}
	return true
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-time.After(d):
	case <-ctx.Done():
	}
}
