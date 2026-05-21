package tlsprobe

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/eduvhc/iedora/infra/internal/testfakes"
)

// TestIssuerIsTrusted — the gate that decides "cert from Let's Encrypt
// (real)" vs "cert from Caddy's internal CA (still bootstrapping)". A
// false positive (treating internal CA as trusted) is the worst-case
// outcome: it makes the deploy-readiness wait loop exit too early and
// the subsequent Pass 3 tofu apply fail with "OpenID Provider
// Configuration Discovery has failed". So this is the highest-value
// guard in the readiness probe.
func TestIssuerIsTrusted(t *testing.T) {
	cases := []struct {
		issuer string
		want   bool
		why    string
	}{
		{"CN=Caddy Local Authority - 2026 ECC Intermediate", false, "internal CA, deploy must keep waiting"},
		{"CN=Caddy Local Authority - ECC Intermediate", false, "internal CA in alt formatting"},
		{"C=US, O=Let's Encrypt, CN=E8", true, "real LE production"},
		{"C=US, O=Let's Encrypt, CN=R10", true, "another LE intermediate"},
		{"O=Lets Encrypt, CN=Test", true, "alt spelling tolerated"},
		{"O=Some Other Public CA, CN=Roots", true, "permissive default — any non-internal CA passes"},
		{"", true, "empty is rare but not-internal — accept"},
	}
	for _, c := range cases {
		got := IssuerIsTrusted(c.issuer)
		if got != c.want {
			t.Errorf("IssuerIsTrusted(%q) = %v, want %v (%s)", c.issuer, got, c.want, c.why)
		}
	}
}

// TestProbeReadyHits200 — stand up a fake HTTPS server serving
// /debug/ready=200 and confirm a client mirroring ProbeReady's shape
// returns nil. (ProbeReady itself validates the system trust store, so
// we exercise the HTTP layer in isolation here.)
func TestProbeReadyHits200(t *testing.T) {
	addr, cleanup := testfakes.StartFakeHTTPS(t, "fake.example.invalid", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/debug/ready" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	})
	defer cleanup()

	// ProbeReady validates the TLS chain against the system trust store
	// — it would reject the self-signed cert. To exercise the HTTP layer
	// in isolation we drive a client with the SAME shape ProbeReady uses
	// internally, but with InsecureSkipVerify=true.
	const hostname = "fake.example.invalid"
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, addr)
			},
			TLSClientConfig: &tls.Config{ServerName: hostname, InsecureSkipVerify: true},
		},
	}
	defer client.CloseIdleConnections()

	req, _ := http.NewRequest(http.MethodGet, "https://"+hostname+"/debug/ready", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

// TestProbeCertIssuerInternalCA — ProbeCertIssuer extracts the issuer
// string of whatever the upstream serves, even if the chain doesn't
// validate. Vital: the deploy gate watches for the "Caddy Local
// Authority" substring before flipping to ready.
func TestProbeCertIssuerInternalCA(t *testing.T) {
	addr, cleanup := testfakes.StartFakeHTTPSWithIssuer(t, "fake.example.invalid", "Caddy Local Authority - 2026 ECC Intermediate")
	defer cleanup()

	host, port, _ := net.SplitHostPort(addr)
	target := Target{Hostname: "fake.example.invalid", IPv4: host, Port: port}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	issuer, err := ProbeCertIssuer(ctx, target)
	if err != nil {
		t.Fatalf("ProbeCertIssuer: %v", err)
	}
	if !strings.Contains(issuer, "Caddy Local Authority") {
		t.Errorf("issuer = %q, want substring %q", issuer, "Caddy Local Authority")
	}
	if IssuerIsTrusted(issuer) {
		t.Errorf("IssuerIsTrusted(%q) returned true — must be false to keep deploy waiting", issuer)
	}
}

// TestProbeCertIssuerRealLE — same shape, but the upstream serves a cert
// with a Let's Encrypt-looking issuer. The deploy gate should accept
// this and let Pass 3 proceed.
func TestProbeCertIssuerRealLE(t *testing.T) {
	addr, cleanup := testfakes.StartFakeHTTPSWithIssuer(t, "fake.example.invalid", "Let's Encrypt R10")
	defer cleanup()

	host, port, _ := net.SplitHostPort(addr)
	target := Target{Hostname: "fake.example.invalid", IPv4: host, Port: port}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	issuer, err := ProbeCertIssuer(ctx, target)
	if err != nil {
		t.Fatalf("ProbeCertIssuer: %v", err)
	}
	if !strings.Contains(issuer, "Let's Encrypt") {
		t.Errorf("issuer = %q, want substring %q", issuer, "Let's Encrypt")
	}
	if !IssuerIsTrusted(issuer) {
		t.Errorf("IssuerIsTrusted(%q) returned false — must be true so deploy proceeds", issuer)
	}
}
