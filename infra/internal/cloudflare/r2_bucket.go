// R2 bucket CRUD against the Cloudflare management API (NOT the S3
// API — that lives in internal/r2). Used by the state-bucket
// bootstrap to create the bucket before any Tofu state exists.
package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// R2Bucket is the subset of the CF /accounts/{id}/r2/buckets/{name}
// response shape we care about. CF returns more fields (creation_date,
// storage_class, …) — ignored.
type R2Bucket struct {
	Name     string `json:"name"`
	Location string `json:"location"`
}

// CreateR2Bucket creates `name` under `accountID` with the given
// location hint (e.g. "EEUR" = Europe). Returns (nil, true) if the
// bucket already exists (409 from CF) — the caller treats that as
// success since the binary is idempotent.
//
// CF docs: POST /accounts/{account_id}/r2/buckets
// Body: {"name": "...", "locationHint": "EEUR"}
func CreateR2Bucket(ctx context.Context, cfToken, accountID, name, location string) (existed bool, err error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets", accountID)
	payload := map[string]string{
		"name":         name,
		"locationHint": location,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return false, fmt.Errorf("marshal R2 bucket create body: %w", err)
	}
	_, _, err = doWithRetry(ctx, http.MethodPost, url, cfToken, body)
	if err == nil {
		return false, nil
	}
	// CF returns 409 when the bucket already exists in this account.
	// Some edge versions return 400 with a "10004" error code for the
	// same case — treat both as "already there" to keep the bootstrap
	// idempotent across CF edge behaviour drift.
	if IsStatus(err, http.StatusConflict) || isAlreadyExistsBody(err) {
		return true, nil
	}
	return false, fmt.Errorf("create R2 bucket %q: %w", name, err)
}

// GetR2Bucket returns the bucket if it exists, or (nil, nil) if CF
// returns 404. Any other error propagates.
func GetR2Bucket(ctx context.Context, cfToken, accountID, name string) (*R2Bucket, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s", accountID, name)
	body, _, err := doWithRetry(ctx, http.MethodGet, url, cfToken, nil)
	if err != nil {
		if IsStatus(err, http.StatusNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get R2 bucket %q: %w", name, err)
	}
	var out struct {
		Result R2Bucket `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode R2 bucket %q: %w", name, err)
	}
	return &out.Result, nil
}

// isAlreadyExistsBody is a belt-and-braces check for the case where
// CF returns 400 with a "bucket already exists" envelope rather than
// a clean 409. Matches the documented error code 10004 and the
// human-readable substring "already exists".
func isAlreadyExistsBody(err error) bool {
	var ae *APIError
	if !errors.As(err, &ae) {
		return false
	}
	if ae.Status != http.StatusBadRequest {
		return false
	}
	// Be conservative — only match on the documented error envelope.
	var env struct {
		Errors []struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if json.Unmarshal([]byte(ae.Body), &env) != nil {
		return false
	}
	for _, e := range env.Errors {
		if e.Code == 10004 {
			return true
		}
	}
	return false
}
