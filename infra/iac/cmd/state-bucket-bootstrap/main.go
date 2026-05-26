// state-bucket-bootstrap — one-shot creation of the R2 bucket + scoped
// API token that hold OpenTofu state.
//
// Rule 2 of the environment guardrails (docs/deploy.md § 2): Tofu
// state lives in R2 via the native `s3` backend, never in git. This
// binary is the bootstrap that breaks the chicken-and-egg — the
// state-bucket cannot be managed by Tofu because Tofu needs it to
// store its state. See docs/guardrails-implementation.md § Rule 2.
//
// Idempotent. Re-runs on warm state are a no-diff fast path: the
// bucket already exists (CF 409 → treated as success), the named
// API token already exists (rotated in place via PUT
// /user/tokens/{id}/value to converge BWS), BWS keys are upserted.
//
// Mode — live-only. There is no local equivalent (local Tofu state
// stays on disk). `currentMode = mode.Live` is pinned at the top and
// `currentMode.Require(mode.Live)` gates the run() entry. The --mode
// flag rejects anything other than "live".
//
// Inputs (env, injected by `bws run`):
//
//	IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN  CF token with R2 + user-token-edit perms
//	CLOUDFLARE_ACCOUNT_ID               CF account UUID
//
// Outputs (written to BWS under the iedora-deploy project):
//
//	IAC_BOOTSTRAP_TOFU_STATE_ACCESS_KEY  R2 S3 access key (= CF token ID)
//	IAC_BOOTSTRAP_TOFU_STATE_SECRET_KEY  R2 S3 secret key (= hex(sha256(token-value)))
//	IAC_BOOTSTRAP_TOFU_STATE_BUCKET      bucket name, for the s3 backend block
//
// Flags:
//
//	--mode live  (default; only "live" is accepted)
//	--dry-run    print the CRUD steps without making API calls
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/eduvhc/iedora/internal/bws"
	"github.com/eduvhc/iedora/internal/cloudflare"
	"github.com/eduvhc/iedora/internal/mode"
)

// sha256Hex returns hex(sha256(s)). Pulled into main.go because
// internal/cloudflare's R2S3Credentials does a round-trip to
// /user/tokens/verify to derive the id — we already have the id +
// value in hand from the create/rotate call, so the local derivation
// is cheaper.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// currentMode pins this binary's environment. State-bucket-bootstrap
// is live-only by topology — there is no local R2 to provision.
const currentMode = mode.Live

// Bucket + token names. Hard-coded — these are bootstrap-tier
// identifiers (not configurable per ecosystem) and matching the docs
// matters more than CLI ergonomics.
const (
	bucketName     = "iedora-tofu-state"
	tokenName      = "iedora-tofu-state-r2"
	bucketLocation = "EEUR" // matches infra/iac/tofu/variables.tf::data_bucket_location
)

// BWS keys this binary writes. Stage-of-origin is `iac` per the
// taxonomy in docs/deploy.md (operator-provided / iac-stage
// bootstrap).
const (
	bwsKeyAccessKey = "IAC_BOOTSTRAP_TOFU_STATE_ACCESS_KEY"
	bwsKeySecretKey = "IAC_BOOTSTRAP_TOFU_STATE_SECRET_KEY"
	bwsKeyBucket    = "IAC_BOOTSTRAP_TOFU_STATE_BUCKET"
)

// stderr is the writable sink for human-readable progress lines.
// Indirected through a package var to keep tests deterministic.
var stderr io.Writer = os.Stderr

// cfAPI is the narrow surface the ensureBucket / ensureToken
// orchestrators need from internal/cloudflare. Defined here (not in
// the cloudflare package) because it's a binary-private seam — the
// only consumer is the state-machine test below. Production wiring
// is `realCFAPI`, which forwards to the package functions verbatim.
type cfAPI interface {
	CreateR2Bucket(ctx context.Context, accountID, name, location string) (existed bool, err error)
	GetR2Bucket(ctx context.Context, accountID, name string) (*cloudflare.R2Bucket, error)
	FindAPITokenByName(ctx context.Context, name string) (*cloudflare.Token, error)
	CreateAPIToken(ctx context.Context, in cloudflare.CreateTokenInput) (*cloudflare.Token, error)
	RotateAPITokenValue(ctx context.Context, tokenID string) (string, error)
}

// realCFAPI is the production cfAPI — forwards every call to the
// internal/cloudflare package, threading cfToken through.
type realCFAPI struct{ cfToken string }

func (r realCFAPI) CreateR2Bucket(ctx context.Context, accountID, name, location string) (bool, error) {
	return cloudflare.CreateR2Bucket(ctx, r.cfToken, accountID, name, location)
}
func (r realCFAPI) GetR2Bucket(ctx context.Context, accountID, name string) (*cloudflare.R2Bucket, error) {
	return cloudflare.GetR2Bucket(ctx, r.cfToken, accountID, name)
}
func (r realCFAPI) FindAPITokenByName(ctx context.Context, name string) (*cloudflare.Token, error) {
	return cloudflare.FindAPITokenByName(ctx, r.cfToken, name)
}
func (r realCFAPI) CreateAPIToken(ctx context.Context, in cloudflare.CreateTokenInput) (*cloudflare.Token, error) {
	return cloudflare.CreateAPIToken(ctx, r.cfToken, in)
}
func (r realCFAPI) RotateAPITokenValue(ctx context.Context, tokenID string) (string, error) {
	return cloudflare.RotateAPITokenValue(ctx, r.cfToken, tokenID)
}

func main() {
	stderr = os.Stderr
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "state-bucket-bootstrap: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, argv []string) error {
	// Mode pin — must hold before any side-effecting work.
	currentMode.Require(mode.Live)

	fs := flag.NewFlagSet("state-bucket-bootstrap", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	modeFlag := fs.String("mode", string(mode.Live), "binary environment guardrail — only 'live' accepted")
	dryRun := fs.Bool("dry-run", false, "print the CRUD steps without making API calls")
	if err := fs.Parse(argv); err != nil {
		return err
	}
	if *modeFlag != string(mode.Live) {
		return fmt.Errorf("--mode=%s rejected: state-bucket-bootstrap is live-only — there is no local R2 to provision", *modeFlag)
	}

	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	if *dryRun {
		return runDryRun(cfg)
	}

	// Real run — wire through the production CF + BWS clients.
	return runLive(ctx, cfg)
}

// config bundles the resolved inputs for one bootstrap run.
type config struct {
	cfToken   string // IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN
	accountID string // CLOUDFLARE_ACCOUNT_ID
}

func loadConfig() (config, error) {
	cfg := config{
		cfToken:   os.Getenv("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN"),
		accountID: os.Getenv("CLOUDFLARE_ACCOUNT_ID"),
	}
	if cfg.cfToken == "" {
		return cfg, errors.New("IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN not set (expected to be injected by `bws run`)")
	}
	if cfg.accountID == "" {
		return cfg, errors.New("CLOUDFLARE_ACCOUNT_ID not set (expected to be injected by `bws run`)")
	}
	return cfg, nil
}

func runDryRun(cfg config) error {
	fmt.Fprintln(stderr, "→ DRY RUN — no CF or BWS calls will be made")
	fmt.Fprintf(stderr, "  bucket:   %s (location=%s, account=%s)\n", bucketName, bucketLocation, cfg.accountID)
	fmt.Fprintf(stderr, "  token:    %s (permission group = Workers R2 Storage Bucket Item Write)\n", tokenName)
	fmt.Fprintf(stderr, "  scope:    com.cloudflare.edge.r2.bucket.%s_default_%s\n", cfg.accountID, bucketName)
	fmt.Fprintf(stderr, "  BWS keys: %s, %s, %s\n", bwsKeyAccessKey, bwsKeySecretKey, bwsKeyBucket)
	return nil
}

func runLive(ctx context.Context, cfg config) error {
	api := realCFAPI{cfToken: cfg.cfToken}

	// Step 1: ensure the R2 bucket exists (idempotent).
	if err := ensureBucket(ctx, api, cfg.accountID); err != nil {
		return fmt.Errorf("ensure bucket: %w", err)
	}

	// Step 2: ensure the scoped API token exists, get its current
	// (id, secret-value). On warm runs this rotates the value so BWS
	// converges — see ensureToken's doc for the recovery logic.
	tok, err := ensureToken(ctx, api, cfg.accountID)
	if err != nil {
		return fmt.Errorf("ensure token: %w", err)
	}

	// Step 3: derive R2 S3 credentials from the token. access_key =
	// token ID, secret_key = hex(sha256(token-value)). Matches what
	// `cloudflare_api_token.data_r2` in main.tf does for the data
	// bucket — see internal/cloudflare.R2S3Credentials' doc.
	accessKey, secretKey, err := deriveR2Credentials(tok)
	if err != nil {
		return fmt.Errorf("derive R2 credentials: %w", err)
	}

	// Step 4: write to BWS. If this step fails the token has been
	// created (and possibly rotated) but no one knows the value —
	// print it to stderr so the operator can copy it before exiting
	// (see writeBWSOrPanic's doc).
	if err := writeBWS(ctx, accessKey, secretKey, bucketName); err != nil {
		emergencyLeak(accessKey, secretKey)
		return fmt.Errorf("write BWS: %w", err)
	}

	fmt.Fprintln(stderr, "✓ state-bucket-bootstrap complete")
	fmt.Fprintf(stderr, "  bucket=%s token=%s (id=%s)\n", bucketName, tokenName, tok.ID)
	fmt.Fprintln(stderr, "  BWS keys written:")
	fmt.Fprintf(stderr, "    %s = <token id>\n", bwsKeyAccessKey)
	fmt.Fprintf(stderr, "    %s = <sha256(token value)>\n", bwsKeySecretKey)
	fmt.Fprintf(stderr, "    %s = %s\n", bwsKeyBucket, bucketName)
	fmt.Fprintln(stderr, "  next: add the `backend \"s3\"` block to infra/iac/tofu/versions.tf, then `tofu init -migrate-state`")
	return nil
}

// deriveR2Credentials maps a CF API token to the R2 S3-API credential
// pair. Same convention as internal/cloudflare.R2S3Credentials, but
// re-derived here because we already have the token value in hand
// (no need to round-trip /user/tokens/verify).
func deriveR2Credentials(tok *cloudflare.Token) (accessKey, secretKey string, err error) {
	if tok.ID == "" {
		return "", "", errors.New("token id empty")
	}
	if tok.Value == "" {
		return "", "", errors.New("token value empty (cannot derive R2 secret key)")
	}
	return tok.ID, sha256Hex(tok.Value), nil
}

// writeBWS upserts the three state-bucket secrets into the
// iedora-deploy BWS project. Failure here is the dangerous case: the
// token already exists in CF, but the value is only in process memory.
// The caller's emergencyLeak fallback prints it to stderr so the
// operator can recover.
func writeBWS(ctx context.Context, accessKey, secretKey, bucket string) error {
	pid, err := bws.ProjectID(ctx)
	if err != nil {
		return fmt.Errorf("resolve BWS project id: %w", err)
	}
	fmt.Fprintln(stderr, "→ Upserting BWS keys")
	for _, kv := range []struct{ key, val string }{
		{bwsKeyAccessKey, accessKey},
		{bwsKeySecretKey, secretKey},
		{bwsKeyBucket, bucket},
	} {
		if err := bws.Upsert(ctx, pid, kv.key, kv.val); err != nil {
			return fmt.Errorf("upsert %s: %w", kv.key, err)
		}
		fmt.Fprintf(stderr, "  ✓ %s\n", kv.key)
	}
	return nil
}

// emergencyLeak prints the derived R2 credentials to stderr for the
// chicken-and-egg recovery case (token created, BWS unreachable).
// Operator-only — stderr is not captured into any of our log
// aggregators.
func emergencyLeak(accessKey, secretKey string) {
	fmt.Fprintln(stderr, "")
	fmt.Fprintln(stderr, "! BWS write failed AFTER token creation/rotation.")
	fmt.Fprintln(stderr, "! Copy the credentials below NOW — they cannot be retrieved later:")
	fmt.Fprintf(stderr, "!   %s = %s\n", bwsKeyAccessKey, accessKey)
	fmt.Fprintf(stderr, "!   %s = %s\n", bwsKeySecretKey, secretKey)
	fmt.Fprintf(stderr, "!   %s = %s\n", bwsKeyBucket, bucketName)
	fmt.Fprintln(stderr, "! Then resolve the BWS outage and re-run; the existing token will be rotated, not duplicated.")
	fmt.Fprintln(stderr, "")
}
