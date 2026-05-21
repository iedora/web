package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/eduvhc/iedora/infra/internal/bws"
	"github.com/eduvhc/iedora/infra/internal/cloudflare"
)

// cfAccountResolver is the production CF account-discovery hook. Swapped
// out in env_test.go so tests don't make real HTTP calls.
var cfAccountResolver = cloudflare.AccountID

// buildEnvironment constructs the final KEY=value env slice for the
// command exec — current env, overlaid with every BWS secret, plus the
// TF_VAR_* aliases Tofu reads. Errors if any required secret is missing
// (the cold-start failure mode the operator actually wants).
func buildEnvironment(ctx context.Context, secrets []bws.Secret, bwsAccessToken, projectID string, currentEnv []string) ([]string, error) {
	envMap := make(map[string]string, len(currentEnv)+len(secrets)+16)

	for _, e := range currentEnv {
		k, v, ok := strings.Cut(e, "=")
		if ok {
			envMap[k] = v
		}
	}

	for _, s := range secrets {
		envMap[s.Key] = s.Value
	}

	envMap["BWS_ACCESS_TOKEN"] = bwsAccessToken
	envMap["BWS_PROJECT_ID"] = projectID

	requireKey := func(key string) (string, error) {
		val := envMap[key]
		if val == "" {
			return "", fmt.Errorf("%s missing in environment or BWS secrets", key)
		}
		return val, nil
	}

	// Resolve Cloudflare Account ID if not already pinned in env.
	cfAccountID := envMap["CLOUDFLARE_ACCOUNT_ID"]
	if cfAccountID == "" {
		cfToken, err := requireKey("INFRA_CLOUDFLARE_API_TOKEN")
		if err != nil {
			return nil, err
		}
		discovered, err := cfAccountResolver(ctx, cfToken)
		if err != nil {
			return nil, fmt.Errorf("cloudflare discovery failed: %w", err)
		}
		cfAccountID = discovered
		envMap["CLOUDFLARE_ACCOUNT_ID"] = cfAccountID
	}

	// TF_VAR_* aliases. Adding a new BWS secret that needs to flow
	// through to Tofu is a one-line addition here.
	tfVars := map[string]string{
		"TF_VAR_cloudflare_api_token":              "INFRA_CLOUDFLARE_API_TOKEN",
		"TF_VAR_state_passphrase":                  "INFRA_STATE_PASSPHRASE",
		"TF_VAR_github_token":                      "INFRA_GITHUB_API_TOKEN",
		"TF_VAR_infra_ssh_private_key":             "INFRA_SSH_PRIVATE_KEY",
		"TF_VAR_claude_code_oauth_token":           "INFRA_CLAUDE_CODE_OAUTH_TOKEN",
		"TF_VAR_infra_hcloud_token":                "INFRA_HCLOUD_TOKEN",
		"TF_VAR_infra_ghcr_token":                  "INFRA_GHCR_TOKEN",
		"TF_VAR_infra_openobserve_root_user_email": "INFRA_OPENOBSERVE_ROOT_USER_EMAIL",
	}
	for tfKey, sourceKey := range tfVars {
		val, err := requireKey(sourceKey)
		if err != nil {
			return nil, err
		}
		envMap[tfKey] = val
	}

	envMap["TF_VAR_account_id"] = cfAccountID
	envMap["TF_VAR_bws_access_token"] = bwsAccessToken
	envMap["TF_VAR_bws_project_id"] = projectID
	envMap["TF_VAR_infra_zitadel_sa_key_json"] = envMap["INFRA_ZITADEL_SA_KEY_JSON"]

	envSlice := make([]string, 0, len(envMap))
	for k, v := range envMap {
		envSlice = append(envSlice, k+"="+v)
	}
	return envSlice, nil
}
