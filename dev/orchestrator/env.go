package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// writeMenuEnvFiles composes products/menu/.env from local-stack
// statics + the zitadel-apply outputs.json, then writes excluded-
// service keys to .env.local as `<please_fill>` placeholders.
//
// The .env file is what compose loads (`env_file:` in the menu
// service block) when menu starts. `.env.local` is the operator's
// editable overrides — gitignored — read by menu AFTER .env per
// compose's documented merge order.
//
// All the values here are well-known constants for the local stack
// (the menu image talks to `infra-postgres:5432`, OO at
// `infra-openobserve:5080`, LocalStack at `infra-localstack:4566`).
// No Tofu output reads — that was the previous design's load-bearing
// complexity, replaced by literal strings now that compose owns the
// service layout.
func writeMenuEnvFiles(outputsPath, envPath, envLocalPath string, selected []string) {
	env, err := composeMenuEnv(outputsPath)
	if err != nil {
		fail("compose menu env: %v", err)
	}
	mintAndPersistSessionSecret(outputsPath, env)

	// .env carries every key whose providing service IS in the stack.
	// Excluded services get dropped here + land in .env.local with the
	// `<please_fill>` placeholder for the operator to point elsewhere.
	excluded := excludedEnvKeys(selected)
	excludeSet := map[string]bool{}
	for _, k := range excluded {
		excludeSet[k] = true
	}
	envForFile := map[string]string{}
	for k, v := range env {
		if !excludeSet[k] {
			envForFile[k] = v
		}
	}
	writeEnvFile(envPath, envForFile)
	writeEnvLocal(envLocalPath, excluded)
}

func composeMenuEnv(outputsPath string) (map[string]string, error) {
	out := map[string]string{
		// Static literals — true for the dev container topology.
		"NODE_ENV":                    "development",
		"NEXT_TELEMETRY_DISABLED":     "1",
		"S3_REGION":                   "us-east-1",
		"S3_ACCESS_KEY":               "test",
		"S3_SECRET_KEY":               "test",
		"S3_BUCKET":                   "iedora-assets",
		"IEDORA_ADMIN_EMAILS":         "dev@iedora.local",
		"HOST_NAME":                   "localhost",
		"GIT_SHA":                     "dev",
		"MENU_PUBLIC_URL":             "http://localhost:3000",
		"ZITADEL_ISSUER_URL":          "http://localhost:8080",
		"S3_PUBLIC_URL":               "http://localhost:4566/iedora-assets",
		"DATABASE_URL":                "postgres://postgres:Password1!@infra-postgres:5432/menu",
		"S3_ENDPOINT":                 "http://infra-localstack:4566",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://infra-openobserve:5080/api/default",
		// Same Basic-auth header shape as prod (OO root_user_email +
		// password, base64'd, URL-escaped). Hardcoded for dev.
		"OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Basic%20" + base64.StdEncoding.EncodeToString([]byte("dev@iedora.local:Password1!")),
	}

	// Zitadel-apply outputs (APP_ZITADEL_*). Mapped to the env keys the
	// menu app actually reads.
	outputs, err := readOutputsJSON(outputsPath)
	if err != nil {
		return nil, err
	}
	pull := func(jsonKey, envKey string) {
		if v, ok := outputs[jsonKey]; ok {
			out[envKey] = v
		}
	}
	pull("APP_ZITADEL_MENU_OIDC_CLIENT_ID", "ZITADEL_OAUTH_CLIENT_ID")
	pull("APP_ZITADEL_MENU_OIDC_CLIENT_SECRET", "ZITADEL_OAUTH_CLIENT_SECRET")
	pull("APP_ZITADEL_MENU_SA_TOKEN", "ZITADEL_MANAGEMENT_TOKEN")
	pull("APP_ZITADEL_PERMISSIONS_SIGNING_KEY", "ZITADEL_ACTION_SIGNING_KEY")
	pull("APP_ZITADEL_GRANTS_SIGNING_KEY", "ZITADEL_GRANTS_SIGNING_KEY")
	pull("APP_ZITADEL_IEDORA_PROJECT_ID", "IEDORA_PROJECT_ID")

	if v, ok := outputs["DEPLOY_MENU_SESSION_SECRET"]; ok {
		out["MENU_SESSION_SECRET"] = v
	}
	return out, nil
}

// mintAndPersistSessionSecret puts a stable session secret into the
// env. If outputs.json already has one (warm run), reuse — keeps
// existing local sessions valid across `task local` cycles. If not,
// mint 32 bytes + persist to outputs.json.
func mintAndPersistSessionSecret(outputsPath string, env map[string]string) {
	const k = "DEPLOY_MENU_SESSION_SECRET"
	if _, ok := env["MENU_SESSION_SECRET"]; ok {
		return
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		fail("mint session secret: %v", err)
	}
	secret := base64.RawStdEncoding.EncodeToString(buf)
	env["MENU_SESSION_SECRET"] = secret

	// Persist alongside the zitadel-apply outputs so warm runs reuse it.
	outputs, _ := readOutputsJSON(outputsPath)
	if outputs == nil {
		outputs = map[string]string{}
	}
	outputs[k] = secret
	body, err := json.MarshalIndent(outputs, "", "  ")
	if err != nil {
		fail("marshal outputs: %v", err)
	}
	if err := os.WriteFile(outputsPath, body, 0o600); err != nil {
		fail("write %s: %v", outputsPath, err)
	}
}

func readOutputsJSON(path string) (map[string]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var out map[string]string
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

// writeEnvFile emits the .env file with a stable key order. Includes a
// header explaining the file is auto-generated.
func writeEnvFile(path string, env map[string]string) {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("# AUTO-GENERATED by `task local` (dev/orchestrator).\n")
	b.WriteString("# Composed from local-stack statics + bin/zitadel-apply outputs.\n")
	b.WriteString("# Overrides live in `.env.local` (gitignored).\n\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, env[k])
	}
	if err := os.WriteFile(path, []byte(b.String()), envFileMode); err != nil {
		fail("write %s: %v", path, err)
	}
}

// writeEnvLocal emits .env.local with `<please_fill>` placeholders for
// excluded services. Preserves any operator-overridden values that
// aren't placeholders (so re-running `task local` doesn't wipe edits).
func writeEnvLocal(path string, excluded []string) {
	existing := parseEnvLocal(path)

	if len(excluded) == 0 && len(existing) == 0 {
		_ = os.Remove(path)
		return
	}

	// Drop any prior placeholder for a key that's no longer excluded.
	excludeSet := map[string]bool{}
	for _, k := range excluded {
		excludeSet[k] = true
	}
	for k, v := range existing {
		if v == placeholderValue && !excludeSet[k] {
			delete(existing, k)
		}
	}
	for _, k := range excluded {
		if _, ok := existing[k]; !ok {
			existing[k] = placeholderValue
		}
	}

	keys := make([]string, 0, len(existing))
	for k := range existing {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("# Operator overrides for products/menu/.env. Edit any KEY=value\n")
	b.WriteString("# pair to override what `task local` composes. Keys set to\n")
	b.WriteString("# `<please_fill>` are placeholders for services skipped via\n")
	b.WriteString("# --except — set them to a remote URL (homelab tunnel, prod, …).\n\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, existing[k])
	}
	if err := os.WriteFile(path, []byte(b.String()), envFileMode); err != nil {
		fail("write %s: %v", path, err)
	}
}

// parseEnvLocal reads .env.local as a flat map. Tolerates missing
// file (empty map). Lines starting with `#` and blank lines are
// skipped; KEY=value pairs with quoted values are NOT supported here
// (the orchestrator only writes plain values).
func parseEnvLocal(path string) map[string]string {
	out := map[string]string{}
	body, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out
}

// warnEnvLocalState surfaces a leading warning when .env.local has
// operator-overridden keys (anything that's NOT `<please_fill>` and
// NOT empty) for a service that's in the active selection. Either
// the operator is intentionally shadowing the auto-composed env
// (fine) or they're confused. Either way, surfacing is the right call.
func warnEnvLocalState(envLocalPath string, selected []string) {
	existing := parseEnvLocal(envLocalPath)
	if len(existing) == 0 {
		return
	}
	excludeSet := map[string]bool{}
	for _, k := range excludedEnvKeys(selected) {
		excludeSet[k] = true
	}
	var shadowing []string
	for k, v := range existing {
		v = strings.TrimSpace(v)
		if v == "" || v == placeholderValue {
			continue
		}
		if !excludeSet[k] {
			shadowing = append(shadowing, k)
		}
	}
	if len(shadowing) > 0 {
		sort.Strings(shadowing)
		fmt.Printf("%s ⚠ .env.local shadows %d auto-composed key(s): %s\n",
			logPrefix, len(shadowing), strings.Join(shadowing, ", "))
	}
}
