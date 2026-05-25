// Package cloudflare wraps the bits of the Cloudflare REST API the
// deploy stack needs. Today: account discovery for the wrapping
// `bin/with-secrets` script + token-ID lookup for using a CF API
// token as an R2 S3 access key + R2-bucket / scoped-API-token CRUD
// for the state-bucket bootstrap.
//
// Every outbound request flows through `doWithRetry` — a bounded
// exponential-backoff loop that retries transport errors, HTTP 5xx,
// and HTTP 429. The CF edge serves intermittent 503s for "unknown
// API error" that resolve in a second; without retry, a single one
// fails the whole `just deploy` at the `bin/with-secrets` bootstrap.
package cloudflare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// PermissionGroupR2BucketItemWrite is the global (not per-account),
// stable UUID for "Workers R2 Storage Bucket Item Write". Mirrors
// `infra/tofu/main.tf::locals.permission_group_r2_bucket_item_write`
// so the bootstrap binary and Tofu agree on which permission group to
// bind R2 tokens to. Found via:
//
//	curl -H "Authorization: Bearer $TOKEN" \
//	  https://api.cloudflare.com/client/v4/user/tokens/permission_groups |
//	  jq '.result[] | select(.name=="Workers R2 Storage Bucket Item Write")'
const PermissionGroupR2BucketItemWrite = "2efd5506f9c8494dacb1fa10a3e7d5b6"

var httpClient = &http.Client{Timeout: 10 * time.Second}

// HTTP retry policy. 5 attempts × (1+2+4+8+16=31s) worst-case wait,
// well under any operator's attention budget. Mirrors the shape of
// cmd/zitadel-grant/main.go's `doWithRetry`.
const (
	maxAttempts    = 5
	initialBackoff = time.Second
	maxBackoff     = 16 * time.Second
)

// AccountID returns the Cloudflare account ID associated with cfToken,
// derived from the first zone the token can see (`/zones?per_page=1`).
//
// Why not `/accounts`: that endpoint throws transient 503s ("An unknown
// API error occurred") on our token's account that survive 30+s of
// retry; `/zones` is served by a different CF backend and stays
// healthy. Any token that touches DNS / Workers Routes / R2 custom
// domains has zone scope — true for IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN — so
// this gives the same answer in one call without depending on
// `/accounts`.
//
// If the token genuinely has zero zone perms (none today; would
// require a future Account-only token), the caller falls back to
// pinning `CLOUDFLARE_ACCOUNT_ID` in env.
func AccountID(ctx context.Context, cfToken string) (string, error) {
	var out struct {
		Result []struct {
			Account struct {
				ID string `json:"id"`
			} `json:"account"`
		} `json:"result"`
	}
	if err := getJSON(ctx, "https://api.cloudflare.com/client/v4/zones?per_page=1", cfToken, &out); err != nil {
		return "", err
	}
	if len(out.Result) == 0 {
		return "", fmt.Errorf("CF /zones returned no zones — token lacks zone scope; pin CLOUDFLARE_ACCOUNT_ID in env to bypass")
	}
	if out.Result[0].Account.ID == "" {
		return "", fmt.Errorf("CF /zones returned a zone with no account.id — unexpected CF response shape")
	}
	return out.Result[0].Account.ID, nil
}

// R2S3Credentials derives the R2 S3-API access key + secret key from a
// Cloudflare API token. Convention (matches what containers.tf does for
// the per-bucket tokens): access_key = token's CF ID, secret_key =
// hex(sha256(token-value)).
//
// Requires the token to carry "Workers R2 Storage Bucket Item Write" (or
// equivalent) on the target account; otherwise the S3 calls will 403.
//
// We use this for the pre-destroy bucket-empty step because the per-
// bucket tokens are typically already gone from state by the time the
// bucket-delete fails (Tofu destroys leaves first), and the global
// IAC_BOOTSTRAP_CLOUDFLARE_API_TOKEN is the only credential we can rely on
// being present.
func R2S3Credentials(ctx context.Context, cfToken string) (accessKey, secretKey string, err error) {
	id, err := tokenID(ctx, cfToken)
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(cfToken))
	return id, hex.EncodeToString(sum[:]), nil
}

// tokenID returns the Cloudflare token ID for a given bearer token.
// Calls /user/tokens/verify which returns `{ result: { id, status } }`.
func tokenID(ctx context.Context, cfToken string) (string, error) {
	var out struct {
		Result struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"result"`
	}
	if err := getJSON(ctx, "https://api.cloudflare.com/client/v4/user/tokens/verify", cfToken, &out); err != nil {
		return "", err
	}
	if out.Result.ID == "" {
		return "", fmt.Errorf("CF /user/tokens/verify returned empty token id (status=%q)", out.Result.Status)
	}
	return out.Result.ID, nil
}

// getJSON GETs the URL with bearer auth, decoding the 2xx body into
// `target`. Retries on transport errors + HTTP 5xx + HTTP 429.
// 4xx propagates immediately (bad token, missing endpoint — no point
// retrying).
func getJSON(ctx context.Context, url, bearer string, target any) error {
	body, _, err := doWithRetry(ctx, http.MethodGet, url, bearer, nil)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("decode CF response: %w", err)
	}
	return nil
}

// doWithRetry issues an HTTP request with bounded exponential backoff.
// Returns the response body + status on the first 2xx, or the last
// error on exhaustion. 4xx responses (except 429) propagate
// immediately with the response status surfaced — callers that want
// to special-case e.g. 409 ("already exists") can inspect the
// returned APIError.
func doWithRetry(ctx context.Context, method, url, bearer string, body []byte) ([]byte, int, error) {
	backoff := initialBackoff
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		respBody, status, err := doOnce(ctx, method, url, bearer, body)

		// Success.
		if err == nil && status >= 200 && status < 300 {
			return respBody, status, nil
		}

		// Deterministic failure — don't retry. Return a typed error
		// so callers can branch on status (e.g. 409 → already exists).
		if err == nil && status >= 400 && status < 500 && status != http.StatusTooManyRequests {
			return respBody, status, &APIError{Method: method, URL: url, Status: status, Body: string(respBody)}
		}

		// Build a diagnostic for this attempt.
		switch {
		case err != nil:
			lastErr = fmt.Errorf("transport: %w", err)
		default:
			lastErr = fmt.Errorf("CF %s %s returned %d: %s", method, url, status, string(respBody))
		}

		if attempt == maxAttempts {
			break
		}

		// Honor context cancellation while waiting.
		select {
		case <-ctx.Done():
			return nil, 0, errors.Join(lastErr, ctx.Err())
		case <-time.After(backoff):
		}
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
	return nil, 0, fmt.Errorf("CF API gave up after %d attempts: %w", maxAttempts, lastErr)
}

// doOnce dispatches a single request. Body is always drained +
// returned so callers can include it in error messages.
func doOnce(ctx context.Context, method, url, bearer string, body []byte) ([]byte, int, error) {
	var reqBody io.Reader
	if body != nil {
		reqBody = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, 0, fmt.Errorf("create CF request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, readErr := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, readErr
}

// APIError is the typed error doWithRetry returns for deterministic
// HTTP failures (4xx that aren't 429). Callers that need to branch on
// status (e.g. 409 → already exists, treat as no-op) use errors.As.
type APIError struct {
	Method string
	URL    string
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("CF %s %s returned %d: %s", e.Method, e.URL, e.Status, e.Body)
}

// IsStatus reports whether err wraps an APIError with the given HTTP
// status. Convenience over errors.As at the call site.
func IsStatus(err error, status int) bool {
	var ae *APIError
	if errors.As(err, &ae) {
		return ae.Status == status
	}
	return false
}
