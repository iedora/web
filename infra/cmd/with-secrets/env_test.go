package main

import (
	"context"
	"strings"
	"testing"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

func TestBuildEnvironment(t *testing.T) {
	// Stub the CF resolver — tests must not hit the live API.
	prev := cfAccountResolver
	defer func() { cfAccountResolver = prev }()
	cfAccountResolver = func(context.Context, string) (string, error) {
		return "cf-account-discovered", nil
	}

	mockSecrets := []bws.Secret{
		{Key: "INFRA_CLOUDFLARE_API_TOKEN", Value: "cf-token-123"},
		{Key: "INFRA_STATE_PASSPHRASE", Value: "passphrase-abc"},
		{Key: "INFRA_GITHUB_API_TOKEN", Value: "github-token-456"},
		{Key: "INFRA_SSH_PRIVATE_KEY", Value: "ssh-key-789"},
		{Key: "INFRA_CLAUDE_CODE_OAUTH_TOKEN", Value: "claude-token-xyz"},
		{Key: "INFRA_HCLOUD_TOKEN", Value: "hcloud-token-uvw"},
		{Key: "INFRA_GHCR_TOKEN", Value: "ghcr-token-qrs"},
		{Key: "INFRA_OPENOBSERVE_ROOT_USER_EMAIL", Value: "test@example.com"},
	}

	// CLOUDFLARE_ACCOUNT_ID pinned → resolver should NOT be called.
	mockEnv := []string{
		"PATH=/usr/bin:/bin",
		"CLOUDFLARE_ACCOUNT_ID=cf-account-abc",
		"INFRA_ZITADEL_SA_KEY_JSON=sa-key-json-string",
	}

	bwsAccessToken := "token-bws-123"
	projectID := "project-id-456"

	envSlice, err := buildEnvironment(t.Context(), mockSecrets, bwsAccessToken, projectID, mockEnv)
	if err != nil {
		t.Fatalf("buildEnvironment failed unexpectedly: %v", err)
	}

	getVal := func(key string) string {
		prefix := key + "="
		for _, env := range envSlice {
			if strings.HasPrefix(env, prefix) {
				return strings.TrimPrefix(env, prefix)
			}
		}
		return ""
	}

	if getVal("BWS_ACCESS_TOKEN") != bwsAccessToken {
		t.Errorf("Expected BWS_ACCESS_TOKEN=%s, got %s", bwsAccessToken, getVal("BWS_ACCESS_TOKEN"))
	}
	if getVal("BWS_PROJECT_ID") != projectID {
		t.Errorf("Expected BWS_PROJECT_ID=%s, got %s", projectID, getVal("BWS_PROJECT_ID"))
	}

	expectedTFVars := map[string]string{
		"TF_VAR_account_id":                        "cf-account-abc",
		"TF_VAR_cloudflare_api_token":              "cf-token-123",
		"TF_VAR_state_passphrase":                  "passphrase-abc",
		"TF_VAR_github_token":                      "github-token-456",
		"TF_VAR_infra_ssh_private_key":             "ssh-key-789",
		"TF_VAR_claude_code_oauth_token":           "claude-token-xyz",
		"TF_VAR_infra_hcloud_token":                "hcloud-token-uvw",
		"TF_VAR_infra_ghcr_token":                  "ghcr-token-qrs",
		"TF_VAR_infra_openobserve_root_user_email": "test@example.com",
		"TF_VAR_infra_zitadel_sa_key_json":         "sa-key-json-string",
	}
	for key, expectedVal := range expectedTFVars {
		if gotVal := getVal(key); gotVal != expectedVal {
			t.Errorf("Expected variable %s to have value %q, got %q", key, expectedVal, gotVal)
		}
	}
}

func TestBuildEnvironment_DiscoversCloudflareAccount(t *testing.T) {
	prev := cfAccountResolver
	defer func() { cfAccountResolver = prev }()
	called := false
	cfAccountResolver = func(context.Context, string) (string, error) {
		called = true
		return "cf-account-discovered", nil
	}

	secrets := []bws.Secret{
		{Key: "INFRA_CLOUDFLARE_API_TOKEN", Value: "cf-token-123"},
		{Key: "INFRA_STATE_PASSPHRASE", Value: "p"},
		{Key: "INFRA_GITHUB_API_TOKEN", Value: "g"},
		{Key: "INFRA_SSH_PRIVATE_KEY", Value: "s"},
		{Key: "INFRA_CLAUDE_CODE_OAUTH_TOKEN", Value: "c"},
		{Key: "INFRA_HCLOUD_TOKEN", Value: "h"},
		{Key: "INFRA_GHCR_TOKEN", Value: "gh"},
		{Key: "INFRA_OPENOBSERVE_ROOT_USER_EMAIL", Value: "e"},
	}
	envSlice, err := buildEnvironment(t.Context(), secrets, "tok", "proj", nil)
	if err != nil {
		t.Fatalf("buildEnvironment: %v", err)
	}
	if !called {
		t.Fatal("expected cfAccountResolver to be called (no pinned CLOUDFLARE_ACCOUNT_ID)")
	}
	for _, e := range envSlice {
		if e == "TF_VAR_account_id=cf-account-discovered" {
			return
		}
	}
	t.Errorf("TF_VAR_account_id did not pick up discovered account id")
}

func TestBuildEnvironment_MissingSecret(t *testing.T) {
	mockSecrets := []bws.Secret{
		{Key: "INFRA_CLOUDFLARE_API_TOKEN", Value: "cf-token-123"},
		{Key: "INFRA_GITHUB_API_TOKEN", Value: "github-token-456"},
		{Key: "INFRA_SSH_PRIVATE_KEY", Value: "ssh-key-789"},
		{Key: "INFRA_CLAUDE_CODE_OAUTH_TOKEN", Value: "claude-token-xyz"},
		{Key: "INFRA_HCLOUD_TOKEN", Value: "hcloud-token-uvw"},
		{Key: "INFRA_GHCR_TOKEN", Value: "ghcr-token-qrs"},
		{Key: "INFRA_OPENOBSERVE_ROOT_USER_EMAIL", Value: "test@example.com"},
	}

	mockEnv := []string{"CLOUDFLARE_ACCOUNT_ID=cf-account-abc"}

	_, err := buildEnvironment(t.Context(), mockSecrets, "token-123", "proj-123", mockEnv)
	if err == nil {
		t.Fatal("Expected buildEnvironment to fail due to missing INFRA_STATE_PASSPHRASE, but it succeeded")
	}
	if !strings.Contains(err.Error(), "INFRA_STATE_PASSPHRASE missing") {
		t.Errorf("Expected error to mention INFRA_STATE_PASSPHRASE missing, got: %v", err)
	}
}
