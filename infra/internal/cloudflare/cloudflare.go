// Package cloudflare wraps the bits of the Cloudflare REST API the
// deploy stack needs. Today: account discovery for the wrapping
// `bin/with-secrets` script.
package cloudflare

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

// AccountID returns the first Cloudflare account ID reachable with
// cfToken. Returns an error if the token has no account scope.
func AccountID(ctx context.Context, cfToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.cloudflare.com/client/v4/accounts", nil)
	if err != nil {
		return "", fmt.Errorf("create CF request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("query CF accounts API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("CF API returned %d: %s", resp.StatusCode, string(body))
	}

	var out struct {
		Result []struct {
			ID string `json:"id"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode CF response: %w", err)
	}
	if len(out.Result) == 0 {
		return "", fmt.Errorf("CF /accounts returned no accounts — check INFRA_CLOUDFLARE_API_TOKEN scope")
	}
	return out.Result[0].ID, nil
}
