package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ── constants ────────────────────────────────────────────────────────────────

const (
	logPrefix          = "[local]"
	zitadelReadyBudget = 90 * time.Second
	envFileMode        = 0o600
	placeholderValue   = "<please_fill>"
)

// ── service catalog ──────────────────────────────────────────────────────────
//
// Each entry is one compose profile. `envKeys` is the menu env keys
// the service provides — when the service is in --except, those keys
// land in .env.local as `<please_fill>` so the operator points them
// at a remote URL (homelab tunnel, prod, etc).
//
// `deps` mirrors compose's depends_on so --only behaves like the dev
// stack used to: selecting a leaf brings its prereqs along.

type service struct {
	name    string
	deps    []string
	envKeys []string
}

var allServices = []service{
	{name: "postgres", envKeys: []string{"DATABASE_URL"}},
	{name: "localstack", envKeys: []string{"S3_ENDPOINT", "S3_PUBLIC_URL"}},
	{name: "openobserve", deps: []string{"localstack"}, envKeys: []string{"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"}},
	// zitadel covers the bootstrap-init + main binary + login UI compose
	// services (they share the `zitadel` profile in docker-compose.yml).
	{name: "zitadel", deps: []string{"postgres"}},
	{name: "house"},
	// menu's deps include zitadel for the env composition (OIDC + PAT)
	// + postgres for DATABASE_URL + localstack for S3 + openobserve for
	// OTel headers. All four are implied by the env values it consumes.
	{name: "menu", deps: []string{"postgres", "localstack", "openobserve", "zitadel"}},
}

func serviceNames() []string {
	out := make([]string, len(allServices))
	for i, s := range allServices {
		out[i] = s.name
	}
	return out
}

// expandDeps closes selected over service.deps. Used so `--only menu`
// brings postgres/openobserve/etc. along.
func expandDeps(selected []string) []string {
	byName := map[string]service{}
	for _, s := range allServices {
		byName[s.name] = s
	}
	set := map[string]bool{}
	var dfs func(string)
	dfs = func(n string) {
		if set[n] {
			return
		}
		s, ok := byName[n]
		if !ok {
			fail("unknown service %q (known: %v)", n, serviceNames())
		}
		set[n] = true
		for _, d := range s.deps {
			dfs(d)
		}
	}
	for _, n := range selected {
		dfs(n)
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	return sortedUnique(out)
}

// excludedEnvKeys returns env keys whose providing service is NOT in
// selected. Feeds the `<please_fill>` placeholder mechanism.
func excludedEnvKeys(selected []string) []string {
	var out []string
	for _, s := range allServices {
		if len(s.envKeys) == 0 || contains(selected, s.name) {
			continue
		}
		out = append(out, s.envKeys...)
	}
	return out
}

func withoutMenu(selected []string) []string {
	out := make([]string, 0, len(selected))
	for _, s := range selected {
		if s != "menu" {
			out = append(out, s)
		}
	}
	return out
}

// ── CLI ──────────────────────────────────────────────────────────────────────

type cliArgs struct {
	only    string
	except  string
	destroy bool
	resetDB string
}

func parseFlags() cliArgs {
	var a cliArgs
	flag.StringVar(&a.only, "only", "", "comma-separated services to start (+ deps)")
	flag.StringVar(&a.except, "except", "", "comma-separated services to skip; everything else starts")
	flag.BoolVar(&a.destroy, "destroy", false, "tear down: `docker compose down -v` + wipe bootstrap + .env.local")
	flag.StringVar(&a.resetDB, "reset-db", "", "drop+recreate one database (`menu` or `zitadel`) without touching the rest")
	flag.Parse()
	if a.only != "" && a.except != "" {
		fail("--only and --except are mutually exclusive")
	}
	return a
}

func (a cliArgs) resolveSelection() ([]string, error) {
	if a.only != "" {
		return expandDeps(splitCSV(a.only)), nil
	}
	picked := serviceNames()
	if a.except != "" {
		skip := map[string]bool{}
		for _, n := range splitCSV(a.except) {
			if _, ok := serviceByName(n); !ok {
				return nil, fmt.Errorf("--except: unknown service %q (known: %v)", n, serviceNames())
			}
			skip[n] = true
		}
		picked = filterOut(picked, skip)
	}
	return expandDeps(picked), nil
}

func serviceByName(n string) (service, bool) {
	for _, s := range allServices {
		if s.name == n {
			return s, true
		}
	}
	return service{}, false
}

// ── docker compose helpers ───────────────────────────────────────────────────

// composeUp runs `docker compose up -d --wait` with one --profile flag
// per selected service. --wait blocks until healthchecks pass (compose
// native). Streams stderr/stdout to the operator.
func composeUp(ctx context.Context, composeDir string, profiles []string) {
	args := []string{"compose"}
	for _, p := range profiles {
		args = append(args, "--profile", p)
	}
	args = append(args, "up", "-d", "--wait")
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = composeDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("docker compose up: %v", err)
	}
}

func composeDown(ctx context.Context, composeDir string) {
	// `-v` wipes named volumes; `--profile '*'` ensures profile-gated
	// services are included in the teardown.
	cmd := exec.CommandContext(ctx, "docker", "compose", "--profile", "*", "down", "-v", "--remove-orphans")
	cmd.Dir = composeDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run() // best-effort
}

// dockerCp reads a file out of a named volume via `docker cp`. The
// FirstInstance-minted SA key lives in the zitadel_bootstrap volume —
// no host bind mount (avoids UID-mismatch chmod gymnastics), so we
// pull it out for the one-shot zitadel-apply invocation.
func dockerCp(ctx context.Context, container, path string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "docker", "cp", container+":"+path, "-")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("docker cp %s:%s: %w", container, path, err)
	}
	// `docker cp ... -` emits a tar stream. Strip the tar wrapper to
	// get the raw file body.
	return untarSingleFile(out)
}

// runZitadelApply exec's `bin/zitadel-apply --mode local
// --output-file <outputsPath>` with the SA key injected via env.
func runZitadelApply(ctx context.Context, bin, saKey, outputsPath string) {
	cmd := exec.CommandContext(ctx, bin, "--mode", "local", "--output-file", outputsPath)
	cmd.Env = append(os.Environ(),
		"IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON="+saKey,
		"ZA_BASE_URL=http://localhost:8080",
		"ZA_MENU_HOSTNAME=localhost:3000",
	)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("zitadel-apply: %v", err)
	}
}

// ── teardown + reset ─────────────────────────────────────────────────────────

func runDestroy(ctx context.Context, composeDir, bootstrapDir, envLocalPath string) {
	step(1, "docker compose down -v --remove-orphans")
	composeDown(ctx, composeDir)

	step(2, "wipe local bootstrap + .env.local")
	_ = os.RemoveAll(bootstrapDir)
	_ = os.Remove(envLocalPath)
	fmt.Printf("%s ✓ destroyed\n", logPrefix)
}

func runResetDB(ctx context.Context, dbName string) {
	switch dbName {
	case "menu":
		fmt.Printf("%s reset-db: dropping + recreating menu\n", logPrefix)
		execPsql(ctx, `DROP DATABASE IF EXISTS menu;`)
		execPsql(ctx, `CREATE DATABASE menu;`)
	case "zitadel":
		fmt.Printf("%s reset-db zitadel — drops zitadel DB + bootstrap volume; re-run task local to re-bootstrap\n", logPrefix)
		// Stop zitadel containers so we can drop the DB cleanly.
		_ = exec.CommandContext(ctx, "docker", "stop", "infra-zitadel-login", "infra-zitadel").Run()
		execPsql(ctx, `DROP DATABASE IF EXISTS zitadel;`)
		execPsql(ctx, `CREATE DATABASE zitadel;`)
		_ = exec.CommandContext(ctx, "docker", "volume", "rm", "iedora-local_zitadel_bootstrap").Run()
		fmt.Printf("%s ✓ re-run task local to re-bootstrap\n", logPrefix)
	default:
		fail("--reset-db: unknown db %q (want `menu` or `zitadel`)", dbName)
	}
}

func execPsql(ctx context.Context, sql string) {
	cmd := exec.CommandContext(ctx, "docker", "exec", "-i", "infra-postgres",
		"psql", "-U", "postgres", "-d", "postgres", "-c", sql)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("psql: %v", err)
	}
}

// ── HTTP readiness probe ─────────────────────────────────────────────────────

func waitForHTTP200(ctx context.Context, url string, budget time.Duration) error {
	deadline := time.Now().Add(budget)
	for {
		// Pre-flight TCP dial cuts ~150ms off the first poll vs going
		// straight to http.Get (which has its own connect timeout).
		conn, err := net.DialTimeout("tcp", "localhost:8080", 500*time.Millisecond)
		if err == nil {
			conn.Close()
			resp, err := http.Get(url)
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode == 200 {
					return nil
				}
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("waitForHTTP200(%s): timed out after %s", url, budget)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func step(n int, label string) {
	fmt.Printf("%s [%d] %s\n", logPrefix, n, label)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "%s ✗ "+format+"\n", append([]any{logPrefix}, args...)...)
	os.Exit(1)
}

func printNextSteps(selected []string) {
	fmt.Printf("\n%s ✓ local stack ready\n", logPrefix)
	if contains(selected, "menu") {
		fmt.Printf("  → menu     http://localhost:3000\n")
	} else {
		fmt.Printf("  → menu     not in selection (HMR path: cd products/menu && bun run dev)\n")
	}
	if contains(selected, "house") {
		fmt.Printf("  → house    http://localhost:3002\n")
	}
	if contains(selected, "zitadel") {
		fmt.Printf("  → zitadel  http://localhost:8080  (admin: zitadel-admin / Password1!)\n")
	}
	if contains(selected, "openobserve") {
		fmt.Printf("  → o2       http://localhost:5080  (dev@iedora.local / Password1!)\n")
	}
}

func findRepoRoot() string {
	// Walk up from cwd until we find the .git directory.
	dir, err := os.Getwd()
	if err != nil {
		fail("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			fail("findRepoRoot: no .git ancestor of %s", dir)
		}
		dir = parent
	}
}

func splitCSV(s string) []string {
	var out []string
	for _, t := range strings.Split(s, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}

func filterOut(haystack []string, skip map[string]bool) []string {
	out := make([]string, 0, len(haystack))
	for _, h := range haystack {
		if !skip[h] {
			out = append(out, h)
		}
	}
	return out
}

func sortedUnique(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	// stable lexicographic sort
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// untarSingleFile strips a `docker cp ... -` tar stream down to the
// contents of its single regular file entry. Avoids pulling in
// archive/tar by reading the POSIX ustar header inline — `docker cp`
// of a single file emits exactly one entry, 512-byte aligned, no
// PAX extensions for our use case (JSON < 8GB).
func untarSingleFile(stream []byte) ([]byte, error) {
	if len(stream) < 512 {
		return nil, fmt.Errorf("tar stream truncated (%d bytes)", len(stream))
	}
	// Bytes 124..135 = size field, octal ASCII, NUL-padded.
	sizeField := strings.TrimRight(string(stream[124:136]), "\x00 ")
	var size int64
	for _, c := range sizeField {
		if c < '0' || c > '7' {
			return nil, fmt.Errorf("tar size field non-octal: %q", sizeField)
		}
		size = size*8 + int64(c-'0')
	}
	if 512+size > int64(len(stream)) {
		return nil, fmt.Errorf("tar payload truncated (header says %d, have %d)", size, len(stream)-512)
	}
	return stream[512 : 512+size], nil
}
