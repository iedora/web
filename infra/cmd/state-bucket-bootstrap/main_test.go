package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/eduvhc/iedora/infra/internal/cloudflare"
)

// fakeCF is a programmable cfAPI used to drive the idempotency state
// machine without touching the network. Each field is an explicit
// hook so a single test case can override just the calls it cares
// about; default zero-value methods panic to surface accidental
// dependencies.
type fakeCF struct {
	createBucket func(ctx context.Context, accountID, name, location string) (bool, error)
	getBucket    func(ctx context.Context, accountID, name string) (*cloudflare.R2Bucket, error)
	findToken    func(ctx context.Context, name string) (*cloudflare.Token, error)
	createToken  func(ctx context.Context, in cloudflare.CreateTokenInput) (*cloudflare.Token, error)
	rotateToken  func(ctx context.Context, tokenID string) (string, error)

	createTokenCalls int
	rotateTokenCalls int
}

func (f *fakeCF) CreateR2Bucket(ctx context.Context, accountID, name, location string) (bool, error) {
	return f.createBucket(ctx, accountID, name, location)
}
func (f *fakeCF) GetR2Bucket(ctx context.Context, accountID, name string) (*cloudflare.R2Bucket, error) {
	return f.getBucket(ctx, accountID, name)
}
func (f *fakeCF) FindAPITokenByName(ctx context.Context, name string) (*cloudflare.Token, error) {
	return f.findToken(ctx, name)
}
func (f *fakeCF) CreateAPIToken(ctx context.Context, in cloudflare.CreateTokenInput) (*cloudflare.Token, error) {
	f.createTokenCalls++
	return f.createToken(ctx, in)
}
func (f *fakeCF) RotateAPITokenValue(ctx context.Context, tokenID string) (string, error) {
	f.rotateTokenCalls++
	return f.rotateToken(ctx, tokenID)
}

func init() {
	// Silence the binary's progress output during tests. The
	// orchestrators write a handful of "→" / "✓" lines per call.
	stderr = io.Discard
}

// ── ensureBucket ────────────────────────────────────────────────────────────

func TestEnsureBucket(t *testing.T) {
	const acct = "test-account"

	cases := []struct {
		name        string
		fake        *fakeCF
		wantErr     bool
		wantErrSubs []string
	}{
		{
			name: "cold create — bucket does not exist",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) { return false, nil },
				getBucket: func(_ context.Context, _, name string) (*cloudflare.R2Bucket, error) {
					return &cloudflare.R2Bucket{Name: name, Location: bucketLocation}, nil
				},
			},
		},
		{
			name: "warm — bucket already exists (409 → existed=true)",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) { return true, nil },
				getBucket: func(_ context.Context, _, name string) (*cloudflare.R2Bucket, error) {
					return &cloudflare.R2Bucket{Name: name, Location: bucketLocation}, nil
				},
			},
		},
		{
			name: "location drift — CF placed bucket elsewhere (proceed with warning)",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) { return true, nil },
				getBucket: func(_ context.Context, _, name string) (*cloudflare.R2Bucket, error) {
					return &cloudflare.R2Bucket{Name: name, Location: "WNAM"}, nil
				},
			},
		},
		{
			name: "post-create GET returns nil — drift error",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) { return false, nil },
				getBucket: func(_ context.Context, _, _ string) (*cloudflare.R2Bucket, error) {
					return nil, nil
				},
			},
			wantErr:     true,
			wantErrSubs: []string{"reported as existing", "404"},
		},
		{
			name: "create error propagates",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) {
					return false, errors.New("CF down")
				},
			},
			wantErr:     true,
			wantErrSubs: []string{"CF down"},
		},
		{
			name: "GET-confirm error propagates",
			fake: &fakeCF{
				createBucket: func(_ context.Context, _, _, _ string) (bool, error) { return true, nil },
				getBucket: func(_ context.Context, _, _ string) (*cloudflare.R2Bucket, error) {
					return nil, errors.New("transport boom")
				},
			},
			wantErr:     true,
			wantErrSubs: []string{"confirm bucket via GET", "transport boom"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ensureBucket(context.Background(), tc.fake, acct)
			checkErr(t, err, tc.wantErr, tc.wantErrSubs)
		})
	}
}

// ── ensureToken ─────────────────────────────────────────────────────────────

func TestEnsureToken(t *testing.T) {
	const acct = "test-account"

	cases := []struct {
		name             string
		fake             *fakeCF
		wantErr          bool
		wantErrSubs      []string
		wantValue        string
		wantID           string
		wantCreateCalls  int
		wantRotateCalls  int
	}{
		{
			name: "cold — no existing token, POST create",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return nil, nil
				},
				createToken: func(_ context.Context, in cloudflare.CreateTokenInput) (*cloudflare.Token, error) {
					if in.Name != tokenName {
						t.Fatalf("create called with name=%q, want %q", in.Name, tokenName)
					}
					if len(in.Policies) != 1 {
						t.Fatalf("expected 1 policy, got %d", len(in.Policies))
					}
					return &cloudflare.Token{ID: "tok_new", Name: tokenName, Value: "fresh-value"}, nil
				},
			},
			wantValue:       "fresh-value",
			wantID:          "tok_new",
			wantCreateCalls: 1,
		},
		{
			name: "warm — existing token, PUT rotate",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return &cloudflare.Token{ID: "tok_existing", Name: tokenName}, nil
				},
				rotateToken: func(_ context.Context, id string) (string, error) {
					if id != "tok_existing" {
						t.Fatalf("rotate called with id=%q, want %q", id, "tok_existing")
					}
					return "rotated-value", nil
				},
			},
			wantValue:       "rotated-value",
			wantID:          "tok_existing",
			wantRotateCalls: 1,
		},
		{
			name: "warm — rotate 404 → fail loudly with recovery hint",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return &cloudflare.Token{ID: "tok_existing", Name: tokenName}, nil
				},
				rotateToken: func(_ context.Context, id string) (string, error) {
					return "", &cloudflare.APIError{Method: "PUT", URL: "x", Status: http.StatusNotFound, Body: "not found"}
				},
			},
			wantErr:         true,
			wantErrSubs:     []string{"rotate endpoint unavailable", "delete the token", "tok_existing"},
			wantRotateCalls: 1,
		},
		{
			name: "warm — rotate non-404 error propagates",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return &cloudflare.Token{ID: "tok_existing", Name: tokenName}, nil
				},
				rotateToken: func(_ context.Context, id string) (string, error) {
					return "", errors.New("rate limited")
				},
			},
			wantErr:         true,
			wantErrSubs:     []string{"rotate token", "rate limited"},
			wantRotateCalls: 1,
		},
		{
			name: "find error propagates",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return nil, errors.New("list 500")
				},
			},
			wantErr:     true,
			wantErrSubs: []string{"find token by name", "list 500"},
		},
		{
			name: "cold — create error propagates",
			fake: &fakeCF{
				findToken: func(_ context.Context, _ string) (*cloudflare.Token, error) {
					return nil, nil
				},
				createToken: func(_ context.Context, _ cloudflare.CreateTokenInput) (*cloudflare.Token, error) {
					return nil, errors.New("scope rejected")
				},
			},
			wantErr:         true,
			wantErrSubs:     []string{"scope rejected"},
			wantCreateCalls: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tok, err := ensureToken(context.Background(), tc.fake, acct)
			checkErr(t, err, tc.wantErr, tc.wantErrSubs)
			if !tc.wantErr {
				if tok == nil {
					t.Fatal("expected token, got nil")
				}
				if tok.Value != tc.wantValue {
					t.Errorf("token value = %q, want %q", tok.Value, tc.wantValue)
				}
				if tok.ID != tc.wantID {
					t.Errorf("token id = %q, want %q", tok.ID, tc.wantID)
				}
			}
			if tc.fake.createTokenCalls != tc.wantCreateCalls {
				t.Errorf("create calls = %d, want %d", tc.fake.createTokenCalls, tc.wantCreateCalls)
			}
			if tc.fake.rotateTokenCalls != tc.wantRotateCalls {
				t.Errorf("rotate calls = %d, want %d", tc.fake.rotateTokenCalls, tc.wantRotateCalls)
			}
		})
	}
}

// ── deriveR2Credentials ─────────────────────────────────────────────────────

func TestDeriveR2Credentials(t *testing.T) {
	cases := []struct {
		name      string
		tok       *cloudflare.Token
		wantErr   bool
		wantAcc   string
		wantSec   string
	}{
		{
			name:    "happy path — id + value present",
			tok:     &cloudflare.Token{ID: "abc123", Value: "secret-value"},
			wantAcc: "abc123",
			// hex(sha256("secret-value")) — computed once + pinned so a
			// refactor of the derivation function doesn't silently drift.
			wantSec: "31160254d1297393d2ad00e1c01851aec834361e02c524b89fe06aff2879ce6a",
		},
		{
			name:    "empty id rejected",
			tok:     &cloudflare.Token{ID: "", Value: "x"},
			wantErr: true,
		},
		{
			name:    "empty value rejected",
			tok:     &cloudflare.Token{ID: "x", Value: ""},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			acc, sec, err := deriveR2Credentials(tc.tok)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if acc != tc.wantAcc {
				t.Errorf("access = %q, want %q", acc, tc.wantAcc)
			}
			if sec != tc.wantSec {
				t.Errorf("secret = %q, want %q", sec, tc.wantSec)
			}
		})
	}
}

// ── run() flag parsing ──────────────────────────────────────────────────────

func TestRun_RejectsLocalMode(t *testing.T) {
	// Pre-set the required env so loadConfig() doesn't trip first —
	// we want to assert that --mode=local fails at the mode check,
	// not at env validation.
	t.Setenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN", "dummy")
	t.Setenv("CLOUDFLARE_ACCOUNT_ID", "dummy")

	err := run(context.Background(), []string{"--mode", "local"})
	if err == nil {
		t.Fatal("expected error on --mode=local, got nil")
	}
	if !strings.Contains(err.Error(), "live-only") {
		t.Errorf("expected error to mention 'live-only', got: %v", err)
	}
}

func TestRun_DryRunSucceeds(t *testing.T) {
	t.Setenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN", "dummy")
	t.Setenv("CLOUDFLARE_ACCOUNT_ID", "dummy")
	if err := run(context.Background(), []string{"--dry-run"}); err != nil {
		t.Fatalf("dry-run failed: %v", err)
	}
}

func TestLoadConfig_MissingEnv(t *testing.T) {
	t.Setenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN", "")
	t.Setenv("CLOUDFLARE_ACCOUNT_ID", "")
	_, err := loadConfig()
	if err == nil || !strings.Contains(err.Error(), "IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN") {
		t.Fatalf("expected missing-token error, got %v", err)
	}

	t.Setenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN", "dummy")
	_, err = loadConfig()
	if err == nil || !strings.Contains(err.Error(), "CLOUDFLARE_ACCOUNT_ID") {
		t.Fatalf("expected missing-account-id error, got %v", err)
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────

func checkErr(t *testing.T, err error, want bool, subs []string) {
	t.Helper()
	if (err != nil) != want {
		t.Fatalf("err = %v, wantErr = %v", err, want)
	}
	if !want {
		return
	}
	for _, s := range subs {
		if !strings.Contains(err.Error(), s) {
			t.Errorf("err = %q, want substring %q", err.Error(), s)
		}
	}
}
