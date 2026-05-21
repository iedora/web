package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// BWS helpers — thin wrappers over the `bws` CLI. We deliberately don't
// pull in the bitwarden-sdk-secrets Go module: the CLI surface is
// stable, statically linked, already trusted by every other recipe.

type bwsSecret struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

type bwsProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// bwsProjectID returns the BWS project UUID. Pulls from BWS_PROJECT_ID
// if set (matching what bin/with-secrets does); otherwise looks up the
// "iedora-deploy" project by name.
func bwsProjectID(ctx context.Context) (string, error) {
	if id := os.Getenv("BWS_PROJECT_ID"); id != "" {
		return id, nil
	}
	out, err := bwsJSON(ctx, "project", "list")
	if err != nil {
		return "", err
	}
	var projects []bwsProject
	if err := json.Unmarshal(out, &projects); err != nil {
		return "", fmt.Errorf("decoding bws project list: %w", err)
	}
	for _, p := range projects {
		if p.Name == "iedora-deploy" {
			return p.ID, nil
		}
	}
	return "", fmt.Errorf("no BWS project named 'iedora-deploy' (BWS_ACCESS_TOKEN may lack scope)")
}

// bwsListSecrets returns every secret in the project.
func bwsListSecrets(ctx context.Context, projectID string) ([]bwsSecret, error) {
	out, err := bwsJSON(ctx, "secret", "list", projectID)
	if err != nil {
		return nil, err
	}
	var secrets []bwsSecret
	if err := json.Unmarshal(out, &secrets); err != nil {
		return nil, fmt.Errorf("decoding bws secret list: %w", err)
	}
	return secrets, nil
}

// bwsFindSecret returns (id, value) for the given key. ("", "", nil) if
// missing. The list is fetched once and re-scanned (cheap — < 50 secrets).
func bwsFindSecret(secrets []bwsSecret, key string) (id, value string, found bool) {
	for _, s := range secrets {
		if s.Key == key {
			return s.ID, s.Value, true
		}
	}
	return "", "", false
}

// bwsUpsert writes or updates a secret. Idempotent.
func bwsUpsert(ctx context.Context, projectID, key, value string) error {
	secrets, err := bwsListSecrets(ctx, projectID)
	if err != nil {
		return err
	}
	if id, _, found := bwsFindSecret(secrets, key); found {
		// Use stdin to avoid the value showing in argv (ps + history).
		cmd := exec.CommandContext(ctx, "bws", "secret", "edit", id, "--value", value, "-o", "none")
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	cmd := exec.CommandContext(ctx, "bws", "secret", "create", "-o", "none", "--", key, value, projectID)
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// bwsDelete removes a secret by key. No-op if absent.
func bwsDelete(ctx context.Context, projectID, key string) error {
	secrets, err := bwsListSecrets(ctx, projectID)
	if err != nil {
		return err
	}
	id, _, found := bwsFindSecret(secrets, key)
	if !found {
		return nil
	}
	cmd := exec.CommandContext(ctx, "bws", "secret", "delete", id)
	cmd.Stderr = os.Stderr
	cmd.Stdout = nil
	return cmd.Run()
}

func bwsJSON(ctx context.Context, args ...string) ([]byte, error) {
	full := append(args, "-o", "json")
	cmd := exec.CommandContext(ctx, "bws", full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("bws %s: %w (stderr: %s)", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}
