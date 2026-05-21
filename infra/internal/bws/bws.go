// Package bws is a thin client over the `bws` CLI binary.
//
// One canonical implementation, used by every iedora Go command (the
// orchestrator at cmd/iedora, the env wrapper at cmd/with-secrets).
// Deliberately wraps the CLI rather than pulling in the
// bitwarden-sdk-secrets Go module: the CLI surface is stable, statically
// linked, already trusted by every other deploy recipe.
package bws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// DefaultProjectName is the BWS project the orchestrator looks up when
// BWS_PROJECT_ID is not set in env.
const DefaultProjectName = "iedora-deploy"

// Secret is a single BWS secret as returned by `bws secret list -o json`.
type Secret struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

type project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ProjectID returns the UUID of the BWS project iedora deploys into.
// Honors BWS_PROJECT_ID env if set; otherwise looks up DefaultProjectName.
func ProjectID(ctx context.Context) (string, error) {
	if id := os.Getenv("BWS_PROJECT_ID"); id != "" {
		return id, nil
	}
	out, err := runJSON(ctx, "project", "list")
	if err != nil {
		return "", err
	}
	var projects []project
	if err := json.Unmarshal(out, &projects); err != nil {
		return "", fmt.Errorf("decoding bws project list: %w", err)
	}
	for _, p := range projects {
		if p.Name == DefaultProjectName {
			return p.ID, nil
		}
	}
	return "", fmt.Errorf("no BWS project named %q (BWS_ACCESS_TOKEN may lack scope)", DefaultProjectName)
}

// ListSecrets returns every secret in the project.
func ListSecrets(ctx context.Context, projectID string) ([]Secret, error) {
	out, err := runJSON(ctx, "secret", "list", projectID)
	if err != nil {
		return nil, err
	}
	var secrets []Secret
	if err := json.Unmarshal(out, &secrets); err != nil {
		return nil, fmt.Errorf("decoding bws secret list: %w", err)
	}
	return secrets, nil
}

// Find returns (id, value, true) when the key is present in secrets,
// or ("", "", false) when absent.
func Find(secrets []Secret, key string) (id, value string, found bool) {
	for _, s := range secrets {
		if s.Key == key {
			return s.ID, s.Value, true
		}
	}
	return "", "", false
}

// Upsert writes or updates a secret by key. Idempotent — BWS has no
// native upsert, so we list-and-decide.
func Upsert(ctx context.Context, projectID, key, value string) error {
	secrets, err := ListSecrets(ctx, projectID)
	if err != nil {
		return err
	}
	if id, _, found := Find(secrets, key); found {
		cmd := exec.CommandContext(ctx, "bws", "secret", "edit", id, "--value", value, "-o", "none")
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	cmd := exec.CommandContext(ctx, "bws", "secret", "create", "-o", "none", "--", key, value, projectID)
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// Delete removes a secret by key. No-op if absent.
func Delete(ctx context.Context, projectID, key string) error {
	secrets, err := ListSecrets(ctx, projectID)
	if err != nil {
		return err
	}
	id, _, found := Find(secrets, key)
	if !found {
		return nil
	}
	cmd := exec.CommandContext(ctx, "bws", "secret", "delete", id)
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runJSON(ctx context.Context, args ...string) ([]byte, error) {
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
