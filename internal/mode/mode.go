// Package mode encodes the binary environment guardrail from
// docs/deploy/README.md § Environment guardrails (Rule 1): every Iedora
// binary runs in exactly one of two modes.
//
//	mode.Local — operator's machine. Docker daemon on localhost,
//	             adobe/s3mock for S3, no BWS, freely destructible.
//	mode.Live  — Hetzner + Cloudflare + GHCR. Real APIs, real DNS,
//	             gated by the rest of the guardrails.
//
// There is no staging/preview/qa tier and there will not be one.
//
// Usage at boot (cmd/iedora):
//
//	func main() {
//	    m := mode.Live // hardcoded; this binary is live-only
//	    ...
//	}
//
// Usage at boot (cmd/zitadel-apply — runs in both):
//
//	modeFlag := flag.String("mode", "live", "live | local")
//	flag.Parse()
//	m := mode.MustResolve(*modeFlag)
//
// Usage at a destructive entry point:
//
//	func runIacApply(...) error {
//	    m.Require(mode.Live)
//	    ...
//	}
package mode

import (
	"fmt"
)

// Mode is one of Local or Live. Zero value is the empty string;
// callers must Resolve or assign explicitly.
type Mode string

const (
	Local Mode = "local"
	Live  Mode = "live"
)

// Resolve parses s into a Mode.
//
// Empty string returns an error rather than defaulting — a missing
// mode is operator misconfiguration, not a license to pick one. (We
// considered defaulting empty → Live for fail-safe, but that lets
// an unset env var silently shell into production. Explicit beats
// implicit at the boundary.)
func Resolve(s string) (Mode, error) {
	switch Mode(s) {
	case Local, Live:
		return Mode(s), nil
	case "":
		return "", fmt.Errorf("mode: empty value (want %q or %q)", Local, Live)
	default:
		return "", fmt.Errorf("mode: %q is not a valid mode (want %q or %q)", s, Local, Live)
	}
}

// MustResolve is Resolve but panics on error. For main() wiring
// where a bad mode means the operator's environment is broken and
// continuing would be worse than failing fast.
func MustResolve(s string) Mode {
	m, err := Resolve(s)
	if err != nil {
		panic(err)
	}
	return m
}

// Require panics if m != want. Use at the top of any code path that
// is mode-specific — destructive cloud calls, BWS writes, SSH to the
// box. The panic names both the actual and expected mode so the
// operator immediately knows whether they invoked the wrong binary
// or the wrong flag.
func (m Mode) Require(want Mode) {
	if m != want {
		panic(fmt.Sprintf("mode: required %q but running in %q", want, m))
	}
}

// IsLive reports whether m is Live. Useful for guarding non-fatal
// branches (e.g. "in live, write to BWS; in local, write to a file").
func (m Mode) IsLive() bool { return m == Live }

// IsLocal reports whether m is Local.
func (m Mode) IsLocal() bool { return m == Local }

// String returns the underlying string representation. Implements
// fmt.Stringer so %s formatting works without callers thinking about it.
func (m Mode) String() string { return string(m) }
