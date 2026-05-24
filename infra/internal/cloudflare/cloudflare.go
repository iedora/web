// Package cloudflare wraps the bits of the Cloudflare REST API the
// deploy stack needs. Today: account discovery for the wrapping
// `bin/with-secrets` script + token-ID lookup for using a CF API
// token as an R2 S3 access key.
//
// Every outbound request flows through `getWithRetry` — a bounded
// exponential-backoff loop that retries transport errors, HTTP 5xx,
// and HTTP 429. The CF edge serves intermittent 503s for "unknown
// API error" that resolve in a second; without retry, a single one
// fails the whole `just deploy` at the `bin/with-secrets` bootstrap.
package cloudflare

import (
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
	body, err := getWithRetry(ctx, url, bearer)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("decode CF response: %w", err)
	}
	return nil
}

// getWithRetry issues a GET with bounded exponential backoff. Returns
// the response body on the first 2xx, or the last error on exhaustion.
func getWithRetry(ctx context.Context, url, bearer string) ([]byte, error) {
	backoff := initialBackoff
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		body, status, err := getOnce(ctx, url, bearer)

		// Success.
		if err == nil && status >= 200 && status < 300 {
			return body, nil
		}

		// Deterministic failure — don't retry.
		if err == nil && status >= 400 && status < 500 && status != http.StatusTooManyRequests {
			return nil, fmt.Errorf("CF %s returned %d: %s", url, status, string(body))
		}

		// Build a diagnostic for this attempt.
		switch {
		case err != nil:
			lastErr = fmt.Errorf("transport: %w", err)
		default:
			lastErr = fmt.Errorf("CF %s returned %d: %s", url, status, string(body))
		}

		if attempt == maxAttempts {
			break
		}

		// Honor context cancellation while waiting.
		select {
		case <-ctx.Done():
			return nil, errors.Join(lastErr, ctx.Err())
		case <-time.After(backoff):
		}
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
	return nil, fmt.Errorf("CF API gave up after %d attempts: %w", maxAttempts, lastErr)
}

// getOnce dispatches a single GET. Body is always drained + returned so
// callers can include it in error messages.
func getOnce(ctx context.Context, url, bearer string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("create CF request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	return body, resp.StatusCode, readErr
}
