// Dev container orchestrator. One declarative source (OpenTofu) for
// dev AND prod — `infra/modules/services/*` are the building blocks,
// `infra/dev/tofu/` is the dev root, `infra/tofu/` is the prod root.
// No docker-compose.
//
// Default: bring everything up — `just dev`.
//
// Subset selection (each service is a `enable_*` TF input):
//   just dev -i                    interactive TUI per category
//   just dev --only menu           everything menu needs (zitadel + …)
//   just dev --only zitadel        zitadel + postgres only
//   just dev --except openobserve  everything else, deps preserved
//
// The host apps (Next dev for menu) are NOT launched by this script —
// each product owns its own `bun run dev`. The summary at the end
// points the user at the right URLs (always read from the canonical
// source: .env / `docker port`).

package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
)

// ── Service graph ───────────────────────────────────────────────────────────

type category string

const (
	catInfra    category = "infra"
	catProducts category = "products"
)

type service struct {
	name     string   // selection key + TF enable_* suffix + TUI label
	tfVar    string   // empty for products (they're presets, not TF gates)
	deps     []string // transitive selection deps (other service.name values)
	cat      category
	hostRun  bool // true if launched on the host (next dev), false if TF-managed
}

// Ordered for deterministic UI rendering.
var allServices = []service{
	{name: "postgres", tfVar: "enable_postgres", cat: catInfra},
	{name: "localstack", tfVar: "enable_localstack", cat: catInfra},
	{name: "zitadel", tfVar: "enable_zitadel", deps: []string{"postgres"}, cat: catInfra},
	{name: "openobserve", tfVar: "enable_openobserve", deps: []string{"localstack"}, cat: catInfra},
	{name: "house", tfVar: "enable_house", cat: catProducts},
	// `menu` runs in a docker container (same image shape as prod).
	// For HMR, opt out via `--except menu` and `cd products/menu && bun run dev`
	// — `.env` + `.env.local` are written with localhost-DNS for that
	// path. Default path is the container: no HMR, but identical to prod.
	{name: "menu", tfVar: "enable_menu", deps: []string{"postgres", "localstack", "zitadel", "openobserve"}, cat: catProducts},
}

func serviceByName(n string) (service, bool) {
	for _, s := range allServices {
		if s.name == n {
			return s, true
		}
	}
	return service{}, false
}

func defaultSelection() []string {
	out := make([]string, 0, len(allServices))
	for _, s := range allServices {
		out = append(out, s.name)
	}
	return out
}

// expandDeps closes `selected` over `service.deps`. Result is sorted.
func expandDeps(selected []string) []string {
	set := map[string]bool{}
	var dfs func(string)
	dfs = func(n string) {
		if set[n] {
			return
		}
		set[n] = true
		s, ok := serviceByName(n)
		if !ok {
			fail("unknown service %q", n)
		}
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
	sort.Strings(out)
	return out
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	interactive := flag.Bool("i", false, "interactive selection (TUI per category)")
	flag.BoolVar(interactive, "interactive", false, "alias for -i")
	only := flag.String("only", "", "comma-separated services to start (+ their deps); skips everything else")
	except := flag.String("except", "", "comma-separated services to skip; everything else (+ their deps) starts")
	flag.Parse()

	selected, err := resolveSelection(*interactive, *only, *except)
	if err != nil {
		fail("%v", err)
	}
	selected = expandDeps(selected)
	if *except != "" {
		blocked := map[string]bool{}
		for _, n := range splitCSV(*except) {
			blocked[n] = true
		}
		filtered := selected[:0]
		for _, n := range selected {
			if !blocked[n] {
				filtered = append(filtered, n)
			}
		}
		selected = filtered
	}
	if len(selected) == 0 {
		fail("empty selection — pick at least one service")
	}

	repoRoot := findRepoRoot()
	devTofuDir := filepath.Join(repoRoot, "infra/dev/tofu")
	menuDir := filepath.Join(repoRoot, "products/menu")

	fmt.Printf("[dev] selection: %s\n", strings.Join(selected, ", "))

	// Build the -var flags for the enable_* toggles. Anything not in
	// `selected` defaults to false; selected items pass true.
	enableVars := []string{}
	for _, s := range allServices {
		if s.tfVar == "" {
			continue
		}
		enableVars = append(enableVars,
			"-var", fmt.Sprintf("%s=%t", s.tfVar, contains(selected, s.name)))
	}

	step(1, "tofu init")
	runIn(devTofuDir, "tofu", "init", "-upgrade", "-input=false")

	step(2, "tofu apply -target=... (containers — first pass)")
	// First pass targets the docker resources only. zitadel_* /
	// random_password / module.menu_env need the runtime PAT and
	// aren't part of this pass; targeting keeps stale state from
	// previous failed runs from tripping the apply.
	applyArgs := []string{
		"apply", "-auto-approve", "-input=false",
		"-target=docker_network.iedora",
		"-target=docker_volume.postgres_data",
		"-target=docker_volume.localstack_data",
		"-target=docker_volume.openobserve_data",
		"-target=docker_container.zitadel_bootstrap_chmod",
		"-target=module.postgres",
		"-target=module.localstack",
		"-target=module.zitadel",
		"-target=module.zitadel_login",
		"-target=module.openobserve",
		"-target=docker_image.house",
		"-target=module.house",
		// docker_image.menu builds in parallel with the other resources
		// during the first apply (~30s). The container itself can't come
		// up yet (depends on the zitadel seed) — it lands in pass 2.
		"-target=docker_image.menu",
	}
	applyArgs = append(applyArgs, enableVars...)
	runIn(devTofuDir, "tofu", applyArgs...)

	if contains(selected, "zitadel") {
		step(3, "wait for FirstInstance SA key + Zitadel API ready")
		// Mirror prod: FirstInstance mints a JSON RSA key for the
		// `zitadel-admin-sa` machine user; the TF provider auths with it
		// via `jwt_profile_json`. The `menu-sa` PAT used by the menu app
		// is then created by the seed apply as a zitadel_* resource.
		jwtPath := filepath.Join(repoRoot, "infra/dev/.zitadel-bootstrap/zitadel-admin-sa.json")
		if err := waitForFile(jwtPath, 60*time.Second); err != nil {
			fail("%v\nhint: docker logs infra-zitadel", err)
		}
		// File existing only proves FirstInstance ran. Block on
		// /debug/ready (Zitadel's readiness probe) before the seed apply
		// so the API is actually answering gRPC + HTTP.
		if err := waitForHTTPOK("http://localhost:8080/debug/ready", 60*time.Second); err != nil {
			fail("%v\nhint: docker logs infra-zitadel", err)
		}
		jwtBytes, err := os.ReadFile(jwtPath)
		if err != nil {
			fail("read %s: %v", jwtPath, err)
		}

		step(4, "tofu apply (seed Zitadel + emit env files)")
		seedArgs := append([]string{"apply", "-auto-approve", "-input=false"}, enableVars...)
		// JSON is multi-line + contains quotes — passing via TF_VAR env
		// avoids shell-escaping. Same channel prod's `with-secrets` uses
		// for `TF_VAR_infra_zitadel_sa_key_json`.
		runInWithEnv(devTofuDir,
			[]string{"TF_VAR_zitadel_jwt_profile=" + string(jwtBytes)},
			"tofu", seedArgs...)

		// `.env` (committed) is fully TF-owned — overwrite on every run.
		writeEnvFile(filepath.Join(menuDir, ".env"),
			captureIn(devTofuDir, "tofu", "output", "-raw", "env_committable_file"),
			false, 0o644)

		// `.env.local` (gitignored) is USER-owned — never overwritten.
		// We schema-sync: add missing dynamic keys as `<please_fill>`,
		// warn on stale keys, keep user values intact. The real values
		// are printed below so the user can paste them in once.
		expectedKeys := splitLines(captureIn(devTofuDir, "tofu", "output", "-json", "env_dynamic_keys"))
		syncEnvLocal(filepath.Join(menuDir, ".env.local"), expectedKeys)

		// Print the real dynamic values for first-run copy-paste.
		realValues := captureIn(devTofuDir, "tofu", "output", "-raw", "env_dynamic_file")
		printDynamicValues(realValues)
	} else if contains(selected, "menu") {
		warn("zitadel opted out — products/menu/.env.local not touched. Provide ZITADEL_OAUTH_CLIENT_ID/SECRET/MANAGEMENT_TOKEN yourself or auth flows will 500.")
	}

	printNextSteps(selected, repoRoot, devTofuDir)
}

// ── Selection: flags + interactive ──────────────────────────────────────────

func resolveSelection(interactive bool, only, except string) ([]string, error) {
	if interactive {
		return runTUI()
	}
	if only != "" && except != "" {
		return nil, fmt.Errorf("--only and --except are mutually exclusive")
	}
	if only != "" {
		return splitCSV(only), nil
	}
	if except != "" {
		excluded := map[string]bool{}
		for _, n := range splitCSV(except) {
			excluded[n] = true
		}
		out := []string{}
		for _, s := range allServices {
			if !excluded[s.name] {
				out = append(out, s.name)
			}
		}
		return out, nil
	}
	return defaultSelection(), nil
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func runTUI() ([]string, error) {
	groups := map[category][]huh.Option[string]{}
	for _, s := range allServices {
		groups[s.cat] = append(groups[s.cat], huh.NewOption(s.name, s.name).Selected(true))
	}

	var infraSelected, productsSelected []string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("infra").
				Description("Backing services. Postgres + LocalStack required for any menu work; Zitadel optional if pointing at a remote IdP; OpenObserve optional.").
				Options(groups[catInfra]...).
				Value(&infraSelected),
		),
		huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("products").
				Description("Pick what you'll be working on. `menu` boots host-side (cd products/menu && bun run dev). `house` runs in a container.").
				Options(groups[catProducts]...).
				Value(&productsSelected),
		),
	)
	if err := form.Run(); err != nil {
		return nil, err
	}
	return append(infraSelected, productsSelected...), nil
}

// ── Summary + file helpers ──────────────────────────────────────────────────

func printNextSteps(selected []string, repoRoot, tofuDir string) {
	fmt.Println()
	fmt.Println("[dev] infra is up.")
	if contains(selected, "menu") {
		fmt.Printf("  menu (container):  %s   # same image as prod\n",
			composePort(tofuDir, "infra-menu-web", "3000"))
		fmt.Println("                     for HMR: just dev --except menu  && cd products/menu && bun run dev")
	}
	if contains(selected, "house") {
		fmt.Printf("  house (container): %s   # Astro static (busybox httpd)\n",
			composePort(tofuDir, "infra-house", "80"))
	}
	if !contains(selected, "menu") && !contains(selected, "house") {
		fmt.Println("  (no product selected — infra stays up for ad-hoc work)")
	}
}

func writeEnvFile(path, body string, _ bool, mode os.FileMode) {
	if body == "" {
		return
	}
	header := "# AUTO-GENERATED by `just dev` (infra/modules/menu_env).\n" +
		"# Static dev defaults + Zod-valid placeholders for the dynamic keys.\n" +
		"# Real values for the dynamic keys live in `.env.local` (gitignored,\n" +
		"# USER-owned — `just dev` only schema-syncs that file, never\n" +
		"# overwrites user values). Commit changes here when the env\n" +
		"# schema evolves.\n\n"
	if err := os.WriteFile(path, []byte(header+body+"\n"), mode); err != nil {
		fail("write %s: %v", path, err)
	}
}

// Managed annotation prefix. Anything starting with this is rewritten on
// each sync; user-authored comments (no `auto:` prefix) are passed through.
const managedNotePrefix = "# auto: "

// envLine captures one KEY=value plus any preceding annotation block
// (managed lines we control, and free-form user comments we preserve).
type envLine struct {
	key      string
	value    string
	managed  string // "added" | "stale" | "" — the lifecycle of the line
	noteDate string // YYYY-MM-DD — preserved across runs when the line stays in the same lifecycle
	userMsg  string // free-form user comment above the key (rare, but preserved)
}

// syncEnvLocal reconciles products/menu/.env.local against the dynamic
// keys the TF module knows about, WITHOUT overwriting user values:
//
//   - Missing keys (in schema but not in file) → added as `<please_fill>`,
//     annotated `# auto: added — …: <YYYY-MM-DD>`
//   - Stale keys (in file but not in schema)   → kept (not removed),
//     annotated `# auto: stale — …: <YYYY-MM-DD>` + stderr WARN
//   - Existing keys (in both)                   → user value preserved,
//     no managed annotation
//
// The annotation date is preserved across runs when the key stays in
// the same state — so the file records WHEN something was first
// detected as missing or went stale, not just "last run". User
// comments (free-form text not starting with `# auto:`) are passed
// through.
func syncEnvLocal(path string, expectedKeys []string) {
	existing := parseEnvLocal(path)
	expectedSet := map[string]bool{}
	for _, k := range expectedKeys {
		expectedSet[k] = true
	}

	today := time.Now().UTC().Format("2006-01-02")

	out := make([]envLine, 0, len(existing)+len(expectedKeys))
	addedNow := []string{}

	// Expected keys first, in canonical (sorted) order.
	for _, k := range expectedKeys {
		prev, ok := existing[k]
		switch {
		case !ok:
			out = append(out, envLine{
				key: k, value: "<please_fill>",
				managed:  "added",
				noteDate: today,
			})
			addedNow = append(addedNow, k)
		case prev.value == "<please_fill>":
			// Still unfilled — keep the original detection date.
			d := prev.noteDate
			if d == "" {
				d = today
			}
			out = append(out, envLine{
				key: k, value: "<please_fill>",
				managed: "added", noteDate: d,
				userMsg: prev.userMsg,
			})
		default:
			// User filled it — strip any managed annotation but
			// keep their free-form comment.
			out = append(out, envLine{
				key: k, value: prev.value,
				userMsg: prev.userMsg,
			})
		}
	}

	// Stale keys (in file but not in schema) — at the end, with the
	// annotation date preserved across runs.
	for k, prev := range existing {
		if expectedSet[k] {
			continue
		}
		d := prev.noteDate
		if d == "" || prev.managed != "stale" {
			d = today
		}
		out = append(out, envLine{
			key: k, value: prev.value,
			managed: "stale", noteDate: d,
			userMsg: prev.userMsg,
		})
		warn(".env.local key %q is stale (not in schema since %s) — safe to remove.", k, d)
	}

	if err := os.WriteFile(path, []byte(renderEnvLocal(out)), 0o600); err != nil {
		fail("write %s: %v", path, err)
	}
	if len(addedNow) > 0 {
		fmt.Printf("[dev] .env.local: added %d new key(s) with `<please_fill>` — %s\n",
			len(addedNow), strings.Join(addedNow, ", "))
	}
}

// parseEnvLocal reads a previous .env.local emit by syncEnvLocal (or
// hand-edited by the user). Recognises:
//   - managed annotations `# auto: <kind> — …: YYYY-MM-DD`
//   - free-form user comments above a KEY= line
//   - KEY=VALUE
func parseEnvLocal(path string) map[string]envLine {
	out := map[string]envLine{}
	raw, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	lines := strings.Split(string(raw), "\n")
	var pendingManagedKind, pendingManagedDate, pendingUserMsg string
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r")
		if strings.HasPrefix(trimmed, managedNotePrefix) {
			// `# auto: added — fill from …: 2026-05-20`
			body := strings.TrimPrefix(trimmed, managedNotePrefix)
			pendingManagedKind = ""
			pendingManagedDate = ""
			if strings.HasPrefix(body, "added") {
				pendingManagedKind = "added"
			} else if strings.HasPrefix(body, "stale") {
				pendingManagedKind = "stale"
			}
			if i := strings.LastIndex(body, ": "); i >= 0 {
				pendingManagedDate = strings.TrimSpace(body[i+2:])
			}
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			if pendingUserMsg == "" {
				pendingUserMsg = trimmed
			} else {
				pendingUserMsg += "\n" + trimmed
			}
			continue
		}
		if trimmed == "" {
			pendingUserMsg = ""
			continue
		}
		eq := strings.IndexByte(trimmed, '=')
		if eq <= 0 {
			continue
		}
		k := trimmed[:eq]
		out[k] = envLine{
			key:      k,
			value:    trimmed[eq+1:],
			managed:  pendingManagedKind,
			noteDate: pendingManagedDate,
			userMsg:  pendingUserMsg,
		}
		pendingManagedKind = ""
		pendingManagedDate = ""
		pendingUserMsg = ""
	}
	return out
}

// renderEnvLocal serialises the reconciled lines back to file content.
func renderEnvLocal(lines []envLine) string {
	var b strings.Builder
	b.WriteString("# USER-owned. `just dev` only schema-syncs this file:\n")
	b.WriteString("#   - missing keys are added as `<please_fill>` with `# auto: added` note\n")
	b.WriteString("#   - stale keys are flagged with `# auto: stale` (not removed)\n")
	b.WriteString("#   - user values + free-form comments are preserved\n")
	b.WriteString("# Dates record FIRST detection — they persist across runs.\n")
	b.WriteString("# To refresh dynamic values from TF, in infra/dev/tofu/:\n")
	b.WriteString("#   tofu output -raw env_dynamic_file\n")
	b.WriteString("\n")
	for _, l := range lines {
		if l.userMsg != "" {
			b.WriteString(l.userMsg)
			b.WriteByte('\n')
		}
		if l.managed == "added" {
			fmt.Fprintf(&b, "%sadded — fill from `tofu output -raw env_dynamic_file`: %s\n",
				managedNotePrefix, l.noteDate)
		} else if l.managed == "stale" {
			fmt.Fprintf(&b, "%sstale — not in menu_env schema since %s, safe to remove\n",
				managedNotePrefix, l.noteDate)
		}
		fmt.Fprintf(&b, "%s=%s\n", l.key, l.value)
		b.WriteByte('\n')
	}
	return b.String()
}

// printDynamicValues echoes the TF-known values for the dynamic keys.
// Lets the user copy-paste into `.env.local` on first run (or after a
// rotation). We never auto-paste — `.env.local` is user-owned.
func printDynamicValues(body string) {
	if body == "" {
		return
	}
	fmt.Println()
	fmt.Println("[dev] TF-known dynamic values (copy into products/menu/.env.local where you see `<please_fill>`):")
	for _, line := range strings.Split(body, "\n") {
		if line == "" {
			continue
		}
		fmt.Println("  " + line)
	}
}

// splitLines parses `tofu output -json` for a list-of-strings output
// and returns each element as a separate string. Stdlib encoding/json
// would be cleaner; this lightweight parse keeps zero new deps.
func splitLines(jsonArray string) []string {
	jsonArray = strings.TrimSpace(jsonArray)
	jsonArray = strings.TrimPrefix(jsonArray, "[")
	jsonArray = strings.TrimSuffix(jsonArray, "]")
	parts := strings.Split(jsonArray, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.Trim(strings.TrimSpace(p), `"`)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func readEnvVar(path, key string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	prefix := key + "="
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimPrefix(line, prefix)
		}
	}
	return ""
}

// composePort returns the host port a container's internal port maps to.
// Replaces the compose-port lookup with a direct `docker port`.
func composePort(_ /*tofuDir*/, container, internal string) string {
	out, err := exec.Command("docker", "port", container, internal).Output()
	if err != nil {
		return "(docker port " + container + " " + internal + " failed)"
	}
	raw := strings.TrimSpace(string(out))
	// Multiple lines (IPv4 + IPv6); take the first.
	if idx := strings.IndexByte(raw, '\n'); idx >= 0 {
		raw = raw[:idx]
	}
	if idx := strings.LastIndex(raw, ":"); idx >= 0 {
		return "http://localhost" + raw[idx:]
	}
	return raw
}

// ── Process helpers ──────────────────────────────────────────────────────────

func findRepoRoot() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		fail("runtime.Caller failed")
	}
	return filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
}

func step(n int, msg string) {
	fmt.Printf("[dev] %d/4  %s\n", n, msg)
}

func warn(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[dev] WARN: "+format+"\n", args...)
}

func runIn(dir, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("%s %v: %v", name, args, err)
	}
}

// runInWithEnv runs a command with extra env vars on top of the
// inherited environment. Used to pass `TF_VAR_zitadel_jwt_profile`
// (multi-line JSON) to `tofu apply` without shell-escaping.
func runInWithEnv(dir string, extraEnv []string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), extraEnv...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fail("%s %v: %v", name, args, err)
	}
}

func captureIn(dir, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		fail("%s %v: %v", name, args, err)
	}
	return strings.TrimSpace(string(out))
}

// waitForHTTPOK polls an HTTP endpoint until it returns a 2xx (or the
// timeout expires). Used to gate the Zitadel seed apply on the API
// actually being reachable — the PAT file existing only proves
// FirstInstance ran; the gRPC + HTTP servers take a couple more
// seconds to come up after that.
func waitForHTTPOK(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		out, _ := exec.Command("curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", url).Output()
		code := strings.TrimSpace(string(out))
		if strings.HasPrefix(code, "2") {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s waiting for %s", timeout, url)
}

func waitForFile(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		info, err := os.Stat(path)
		if err == nil && info.Size() > 0 {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s waiting for %s", timeout, path)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[dev] "+format+"\n", args...)
	os.Exit(1)
}
