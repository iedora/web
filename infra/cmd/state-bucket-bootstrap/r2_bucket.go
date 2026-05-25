// Bucket create-or-find. The internal/cloudflare package owns the CF
// API surface; this file is the thin orchestration glue that prints
// operator-readable progress lines and resolves the "create / already
// there / wrong shape" trichotomy.
package main

import (
	"context"
	"fmt"
)

// ensureBucket creates the R2 bucket if missing, or confirms it
// exists. Returns nil on success in either case.
//
// Idempotency dance: try POST first (cheaper for the cold-start
// case, which is what the binary is mostly run for). If POST 409s
// ("already exists"), the cloudflare helper returns (true, nil).
// Either way: GET once at the end to log the canonical bucket
// location back to the operator.
func ensureBucket(ctx context.Context, api cfAPI, accountID string) error {
	fmt.Fprintf(stderr, "→ Ensuring R2 bucket %s (account=%s, location=%s)\n", bucketName, accountID, bucketLocation)

	existed, err := api.CreateR2Bucket(ctx, accountID, bucketName, bucketLocation)
	if err != nil {
		return err
	}
	if existed {
		fmt.Fprintf(stderr, "  ✓ already exists (skipping create)\n")
	} else {
		fmt.Fprintf(stderr, "  ✓ created\n")
	}

	// Confirm by GET — surfaces a clear error if the bucket lives in
	// a different account or has been moved out from under us.
	got, err := api.GetR2Bucket(ctx, accountID, bucketName)
	if err != nil {
		return fmt.Errorf("confirm bucket via GET: %w", err)
	}
	if got == nil {
		return fmt.Errorf("bucket %q reported as existing but GET returned 404 — CF state drift, retry once", bucketName)
	}
	if got.Location != "" && got.Location != bucketLocation {
		// Not a hard fail — location is a hint, CF may have placed
		// the bucket in a sibling region. Warn so the operator sees
		// it but proceed; the s3 backend doesn't care about region.
		fmt.Fprintf(stderr, "  ! location drift: requested %s, CF reports %s (proceeding — `region=auto` ignores this)\n",
			bucketLocation, got.Location)
	}
	return nil
}
