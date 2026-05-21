// zitadel-grant resolves a list of admin emails to Zitadel user IDs and
// POSTs the iedora-admin project-role grant for each resolved user.
// Idempotent — runs every `just deploy` (and `just dev`) via a Tofu
// `null_resource` + `local-exec`. Already-granted users are skipped
// server-side (Zitadel returns ALREADY_EXISTS, which we treat as success).
//
// Inputs (env, matches Tofu local-exec environment block):
//
//	ZG_HOSTNAME    auth host, e.g. "auth.iedora.com" or "localhost:8080"
//	ZG_SCHEME      "https" (prod) or "http" (local dev)         — optional, default https
//	ZG_TOKEN       menu_sa PAT (IAM_OWNER)
//	ZG_ORG_ID      iedora org id (Zitadel UUID) — sent as x-zitadel-orgid
//	ZG_PROJECT_ID  iedora project id — used as the grant's projectId
//	ZG_ROLE_KEY    role to grant, e.g. "iedora-admin"
//	ZG_EMAILS      JSON-encoded array of emails, e.g. ["a@x","b@x"]
//
// Outcomes per email are printed to stderr (granted / already / skipped).
// Exit status is non-zero only on hard failure (network, bad token,
// malformed input) — unresolved emails (user hasn't signed in yet) are
// reported but not fatal: they land on the next apply after the user
// self-provisions via OIDC.
//
// This script is additive: removing an email from the var does NOT
// revoke the existing grant. Revoke via the Zitadel admin UI.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type config struct {
	Hostname  string
	Scheme    string
	Token     string
	OrgID     string
	ProjectID string
	RoleKey   string
	Emails    []string
}

type searchRequest struct {
	Queries []searchQuery `json:"queries"`
}
type searchQuery struct {
	EmailQuery emailQuery `json:"emailQuery"`
}
type emailQuery struct {
	EmailAddress string `json:"emailAddress"`
	Method       string `json:"method"`
}
type searchResponse struct {
	Result []struct {
		UserID string `json:"userId"`
	} `json:"result"`
}

type grantRequest struct {
	ProjectID string   `json:"projectId"`
	RoleKeys  []string `json:"roleKeys"`
}

type zitadelError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// HTTP retry policy. The Zitadel HTTP gateway can transiently 503 while
// its internal read-model catches up — most commonly right after a
// freshly-minted IAM grant, which is exactly when this helper runs. We
// retry every transient (5xx or network) failure with exponential
// backoff capped at ~60s total wait.
const (
	maxAttempts    = 6
	initialBackoff = time.Second
	maxBackoff     = 16 * time.Second
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "zitadel-grant: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	// 10s per request; retry layer above multiplies this across attempts.
	client := &http.Client{Timeout: 10 * time.Second}

	for _, email := range cfg.Emails {
		userID, err := lookupUser(client, cfg, email)
		if err != nil {
			return fmt.Errorf("lookup %q: %w", email, err)
		}
		if userID == "" {
			fmt.Fprintf(os.Stderr, "skip    %s (no Zitadel user — sign in once via OIDC, then re-run)\n", email)
			continue
		}
		status, err := grant(client, cfg, userID)
		if err != nil {
			return fmt.Errorf("grant %q (%s): %w", email, userID, err)
		}
		fmt.Fprintf(os.Stderr, "%-7s %s (%s)\n", status, email, userID)
	}
	return nil
}

func loadConfig() (*config, error) {
	req := func(k string) (string, error) {
		v := os.Getenv(k)
		if v == "" {
			return "", fmt.Errorf("env %s is required", k)
		}
		return v, nil
	}

	cfg := &config{Scheme: os.Getenv("ZG_SCHEME")}
	if cfg.Scheme == "" {
		cfg.Scheme = "https"
	}
	if cfg.Scheme != "https" && cfg.Scheme != "http" {
		return nil, fmt.Errorf("ZG_SCHEME must be 'http' or 'https', got %q", cfg.Scheme)
	}

	var err error
	if cfg.Hostname, err = req("ZG_HOSTNAME"); err != nil {
		return nil, err
	}
	if cfg.Token, err = req("ZG_TOKEN"); err != nil {
		return nil, err
	}
	if cfg.OrgID, err = req("ZG_ORG_ID"); err != nil {
		return nil, err
	}
	if cfg.ProjectID, err = req("ZG_PROJECT_ID"); err != nil {
		return nil, err
	}
	if cfg.RoleKey, err = req("ZG_ROLE_KEY"); err != nil {
		return nil, err
	}
	emailsJSON, err := req("ZG_EMAILS")
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(emailsJSON), &cfg.Emails); err != nil {
		return nil, fmt.Errorf("parse ZG_EMAILS as JSON array: %w", err)
	}
	return cfg, nil
}

// lookupUser POSTs /v2/users with an email-equality query. Returns the
// first matching userId, or empty string when no match (NOT an error).
func lookupUser(client *http.Client, cfg *config, email string) (string, error) {
	body, err := json.Marshal(searchRequest{
		Queries: []searchQuery{{
			EmailQuery: emailQuery{
				EmailAddress: email,
				Method:       "TEXT_QUERY_METHOD_EQUALS",
			},
		}},
	})
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("%s://%s/v2/users", cfg.Scheme, cfg.Hostname)
	respBody, status, err := doWithRetry(client, http.MethodPost, url, cfg.Token, "", body)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("HTTP %d: %s", status, string(respBody))
	}
	var parsed searchResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("decode response: %w (body: %s)", err, string(respBody))
	}
	if len(parsed.Result) == 0 {
		return "", nil
	}
	return parsed.Result[0].UserID, nil
}

// grant POSTs the user-grant. Returns "granted" on 2xx, "already" when
// Zitadel reports ALREADY_EXISTS (code 6 / HTTP 409 or 412), or an error.
func grant(client *http.Client, cfg *config, userID string) (string, error) {
	body, err := json.Marshal(grantRequest{
		ProjectID: cfg.ProjectID,
		RoleKeys:  []string{cfg.RoleKey},
	})
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("%s://%s/management/v1/users/%s/grants", cfg.Scheme, cfg.Hostname, userID)
	respBody, status, err := doWithRetry(client, http.MethodPost, url, cfg.Token, cfg.OrgID, body)
	if err != nil {
		return "", err
	}
	if status >= 200 && status < 300 {
		return "granted", nil
	}
	if isAlreadyExists(status, respBody) {
		return "already", nil
	}
	return "", fmt.Errorf("HTTP %d: %s", status, string(respBody))
}

// isAlreadyExists treats Zitadel's "grant already exists" as a soft
// success. The API surfaces this as HTTP 409 (or 412 on older
// instances) with a body whose `code` is 6 (gRPC ALREADY_EXISTS).
func isAlreadyExists(status int, body []byte) bool {
	if status != http.StatusConflict && status != http.StatusPreconditionFailed {
		return false
	}
	var ze zitadelError
	if err := json.Unmarshal(body, &ze); err != nil {
		return false
	}
	return ze.Code == 6
}

// do issues the request once. Callers go through `doWithRetry` for
// transient-failure handling — pass `do` directly only when retries are
// actively unwanted.
func do(client *http.Client, method, url, token, orgID string, body []byte) ([]byte, int, error) {
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	if orgID != "" {
		req.Header.Set("x-zitadel-orgid", orgID)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return respBody, resp.StatusCode, nil
}

// doWithRetry wraps `do` with bounded exponential backoff. Retries on:
//   - any transport error (connection refused, timeout, DNS, etc.)
//   - HTTP 5xx (Zitadel's gateway transient-503 while read-model catches
//     up after a fresh IAM grant — the exact race this script hits)
//
// 4xx responses pass through immediately (deterministic — bad token,
// missing user, malformed body). Returns the last response on exhaustion.
func doWithRetry(client *http.Client, method, url, token, orgID string, body []byte) ([]byte, int, error) {
	backoff := initialBackoff
	var lastBody []byte
	var lastStatus int
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		respBody, status, err := do(client, method, url, token, orgID, body)
		lastBody, lastStatus, lastErr = respBody, status, err

		retry := err != nil || (status >= 500 && status <= 599)
		if !retry {
			return respBody, status, err
		}
		if attempt == maxAttempts {
			break
		}

		why := ""
		if err != nil {
			why = err.Error()
		} else {
			why = fmt.Sprintf("HTTP %d", status)
		}
		fmt.Fprintf(os.Stderr, "transient (%s) — retry %d/%d in %s\n",
			why, attempt, maxAttempts-1, backoff)
		time.Sleep(backoff)
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
	return lastBody, lastStatus, lastErr
}
