// User API token CRUD against /user/tokens. Used by the state-bucket
// bootstrap to mint a scoped token for the Tofu s3-backend creds.
//
// Token shape — for an R2-bucket-scoped Item-Write policy — mirrors
// what `cloudflare_api_token.data_r2` in `infra/tofu/main.tf` produces.
// Keeping the JSON marshalling here (not in the binary) means a future
// configurator can reuse the same helpers for, say, a per-product
// scoped token without re-doing the resources-string dance.
package cloudflare

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// TokenPolicy is one entry in a token's policies list.
type TokenPolicy struct {
	Effect           string            `json:"effect"`            // "allow" / "deny"
	PermissionGroups []PermissionGroup `json:"permission_groups"` // by-ID references
	Resources        map[string]string `json:"resources"`         // resource string → "*"
}

// PermissionGroup references a CF permission group by stable UUID.
type PermissionGroup struct {
	ID string `json:"id"`
}

// Token is the subset of the CF /user/tokens response we care about.
// `Value` is only populated by the create + rotate endpoints (one-shot
// reveal); GETs never return it.
type Token struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

// CreateTokenInput is the request body for POST /user/tokens.
type CreateTokenInput struct {
	Name     string        `json:"name"`
	Policies []TokenPolicy `json:"policies"`
}

// CreateAPIToken mints a new token and returns its ID + one-shot
// value. The caller MUST persist Value immediately — CF never reveals
// it again (rotate to recover, see RotateAPITokenValue).
func CreateAPIToken(ctx context.Context, cfToken string, in CreateTokenInput) (*Token, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return nil, fmt.Errorf("marshal token create body: %w", err)
	}
	respBody, _, err := doWithRetry(ctx, http.MethodPost, "https://api.cloudflare.com/client/v4/user/tokens", cfToken, body)
	if err != nil {
		return nil, fmt.Errorf("create CF token %q: %w", in.Name, err)
	}
	var env struct {
		Result Token `json:"result"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return nil, fmt.Errorf("decode token create response: %w", err)
	}
	if env.Result.Value == "" {
		return nil, fmt.Errorf("CF token create returned empty value (id=%q) — refusing to proceed", env.Result.ID)
	}
	return &env.Result, nil
}

// FindAPITokenByName returns the first token whose Name matches, or
// (nil, nil) if absent. CF's /user/tokens endpoint returns a flat list;
// no server-side filtering supported. Pagination is unnecessary in
// practice (token counts in this account stay <50) — we list up to 50
// per page and bail on the first non-match page.
func FindAPITokenByName(ctx context.Context, cfToken, name string) (*Token, error) {
	url := "https://api.cloudflare.com/client/v4/user/tokens?per_page=50"
	body, _, err := doWithRetry(ctx, http.MethodGet, url, cfToken, nil)
	if err != nil {
		return nil, fmt.Errorf("list CF tokens: %w", err)
	}
	var env struct {
		Result []Token `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("decode CF token list: %w", err)
	}
	for i := range env.Result {
		if env.Result[i].Name == name {
			return &env.Result[i], nil
		}
	}
	return nil, nil
}

// RotateAPITokenValue rolls the token's secret in place via
// PUT /user/tokens/{id}/value. The endpoint returns the new value as
// a bare string in `result`. Use this when an existing token's secret
// is lost (BWS desync) — the token ID stays stable, so any consumer
// that pinned the ID keeps working.
//
// CF docs:
// https://developers.cloudflare.com/api/operations/user-api-tokens-roll-token
func RotateAPITokenValue(ctx context.Context, cfToken, tokenID string) (string, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/user/tokens/%s/value", tokenID)
	// PUT with an empty JSON body — CF's roll endpoint takes no params.
	respBody, _, err := doWithRetry(ctx, http.MethodPut, url, cfToken, []byte("{}"))
	if err != nil {
		return "", fmt.Errorf("rotate CF token %s: %w", tokenID, err)
	}
	var env struct {
		// `result` is a bare string for this endpoint, not an object.
		Result string `json:"result"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return "", fmt.Errorf("decode token rotate response: %w", err)
	}
	if env.Result == "" {
		return "", fmt.Errorf("CF token rotate returned empty value for id=%s", tokenID)
	}
	return env.Result, nil
}

// R2BucketScopedPolicy builds the canonical "Workers R2 Storage Bucket
// Item Write" policy scoped to a single bucket. The resource-string
// format
//
//	com.cloudflare.edge.r2.bucket.{account}_default_{bucket}
//
// is the same shape Tofu's cloudflare_api_token resources use — see
// infra/tofu/main.tf::cloudflare_api_token.data_r2.
func R2BucketScopedPolicy(accountID, bucket string) TokenPolicy {
	return TokenPolicy{
		Effect:           "allow",
		PermissionGroups: []PermissionGroup{{ID: PermissionGroupR2BucketItemWrite}},
		Resources: map[string]string{
			fmt.Sprintf("com.cloudflare.edge.r2.bucket.%s_default_%s", accountID, bucket): "*",
		},
	}
}
