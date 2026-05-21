package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"time"
)

// startFakeHTTPS spins up a TLS server with a self-signed cert good for
// hostname, listening on 127.0.0.1 on a random port. Returns "host:port"
// and a cleanup func.
func startFakeHTTPS(t interface {
	Helper()
	Fatalf(string, ...any)
}, hostname string, handler func(http.ResponseWriter, *http.Request)) (addr string, cleanup func()) {
	t.Helper()
	return startFakeHTTPSWithCert(t, hostname, handler, "")
}

// startFakeHTTPSWithIssuer is the issuer-injection variant. Cert is
// signed by an in-test CA whose CN is `issuerCN`, so probeCertIssuer
// will read that string back out. The handler is a no-op 200 — only
// the TLS layer is interesting in those tests.
func startFakeHTTPSWithIssuer(t interface {
	Helper()
	Fatalf(string, ...any)
}, hostname, issuerCN string) (addr string, cleanup func()) {
	t.Helper()
	return startFakeHTTPSWithCert(t, hostname, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	}, issuerCN)
}

func startFakeHTTPSWithCert(t interface {
	Helper()
	Fatalf(string, ...any)
}, hostname string, handler func(http.ResponseWriter, *http.Request), issuerCN string) (string, func()) {
	t.Helper()

	var cert tls.Certificate
	var err error
	if issuerCN == "" {
		cert, err = mintTestCert(hostname)
	} else {
		cert, err = mintTestCertWithIssuer(hostname, issuerCN)
	}
	if err != nil {
		t.Fatalf("mint cert: %v", err)
	}

	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{
		Handler:           http.HandlerFunc(handler),
		ReadHeaderTimeout: 2 * time.Second,
	}
	go func() { _ = srv.Serve(ln) }()
	return ln.Addr().String(), func() { _ = srv.Close(); _ = ln.Close() }
}

// mintTestCert generates a 1-day self-signed P-256 cert for tests.
func mintTestCert(hostname string) (tls.Certificate, error) {
	return mintTestCertWithIssuer(hostname, hostname /* self-issued */)
}

// mintTestCertWithIssuer is like mintTestCert but lets the test control
// the issuer's Common Name. Used to simulate "Caddy Local Authority"
// vs "Let's Encrypt R10" for the cert-ready gate tests.
//
// The leaf is signed by an in-memory CA cert whose Subject.CommonName
// is issuerCN. The leaf's Issuer.CommonName will then be issuerCN —
// exactly what probeCertIssuer reads.
func mintTestCertWithIssuer(hostname, issuerCN string) (tls.Certificate, error) {
	// CA cert.
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	caTmpl := x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: issuerCN},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, &caTmpl, &caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	caParsed, _ := x509.ParseCertificate(caDER)

	// Leaf.
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	leafTmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: hostname},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{hostname},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, &leafTmpl, caParsed, &leafKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	leafKeyDER, err := x509.MarshalECPrivateKey(leafKey)
	if err != nil {
		return tls.Certificate{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: leafKeyDER})
	return tls.X509KeyPair(certPEM, keyPEM)
}
