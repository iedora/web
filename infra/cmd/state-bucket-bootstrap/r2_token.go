// Token create-or-rotate. The recovery model:
//
//	cold (no token by name)  → POST create, capture one-shot value
//	warm (token by name)     → PUT /tokens/{id}/value to rotate, capture new value
//
// Why rotate on warm instead of "trust BWS"? The bootstrap binary's
// failure mode is exactly the case where BWS has a stale or empty
// value (partial prior run, BWS scrubbed, operator-deleted secret).
// Rotation is the convergence path — the token ID stays stable, only
// the secret value changes; existing consumers that pinned the ID
// keep working as soon as the new value lands in BWS one step later.
//
// If CF's rotate endpoint ever 404s (older accounts), the binary
// fails loudly with a recovery hint — we never silently fall through
// to delete + re-create because that would change the token ID.
package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/eduvhc/iedora/infra/internal/cloudflare"
)

// ensureToken returns the canonical token for tokenName with a
// non-empty Value. Caller is responsible for persisting Value to BWS
// immediately — see the emergencyLeak guard in main.go.
func ensureToken(ctx context.Context, api cfAPI, accountID string) (*cloudflare.Token, error) {
	fmt.Fprintf(stderr, "→ Ensuring API token %s\n", tokenName)

	existing, err := api.FindAPITokenByName(ctx, tokenName)
	if err != nil {
		return nil, fmt.Errorf("find token by name: %w", err)
	}

	if existing == nil {
		// Cold path — POST create.
		fmt.Fprintf(stderr, "  → not found, creating\n")
		tok, err := api.CreateAPIToken(ctx, cloudflare.CreateTokenInput{
			Name:     tokenName,
			Policies: []cloudflare.TokenPolicy{cloudflare.R2BucketScopedPolicy(accountID, bucketName)},
		})
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(stderr, "  ✓ created (id=%s)\n", tok.ID)
		return tok, nil
	}

	// Warm path — rotate value in place. The token ID is stable;
	// only the secret rolls. If a future operator pinned this ID
	// outside BWS, that pin stays valid post-rotation.
	fmt.Fprintf(stderr, "  → found existing (id=%s), rotating value\n", existing.ID)
	newValue, err := api.RotateAPITokenValue(ctx, existing.ID)
	if err != nil {
		// 404 from rotate ≠ "token gone". CF returns 404 only on
		// older accounts where the roll endpoint is not enabled.
		// Surface a loud warning + the recovery hint, but treat as
		// a hard error — silent delete+recreate here would change
		// the token ID, which we promised the operator we wouldn't.
		if cloudflare.IsStatus(err, http.StatusNotFound) {
			return nil, fmt.Errorf("rotate endpoint unavailable for token %s: %w\n"+
				"  recovery: delete the token in the CF dashboard, then re-run this binary (cold path)",
				existing.ID, err)
		}
		return nil, fmt.Errorf("rotate token %s: %w", existing.ID, err)
	}
	fmt.Fprintf(stderr, "  ✓ rotated (id=%s; value rolled)\n", existing.ID)
	// FindAPITokenByName doesn't return scope; we can't easily
	// detect "token name matches but resources differ" without
	// another GET per token. Operator-investigates territory if it
	// matters — flag for follow-up.
	return &cloudflare.Token{ID: existing.ID, Name: existing.Name, Value: newValue}, nil
}
