// Dev container orchestrator. Brings up the local dev stack via Tofu,
// then reconciles the local Zitadel via `bin/zitadel-apply --no-bws`
// (Stage 3 in dev mode — writes outputs to a JSON file instead of BWS),
// then composes products/menu/.env + .env.local in Go from a combination
// of Tofu outputs, the JSON outputs file, and minted random secrets.
//
// Mirrors the prod 4-stage pipeline (infra → app → deploy) condensed into
// one operator-friendly entry point. No docker-compose, no BWS dependency,
// no Zitadel TF provider (replaced by the binary).
//
// Default: bring everything up — `task dev`.
//
// Subset selection (each service is a `enable_*` TF input):
//
//	task dev -- -i                    interactive TUI per category
//	task dev -- --only menu           everything menu needs
//	task dev -- --except openobserve  everything else, deps preserved
//	task dev:down                     tear down the full stack
//
// ─── File layout ──────────────────────────────────────────────────────
//
// main.go       Entry point + apply/destroy choreography.
// consts.go     Centralised magic strings — paths, output names.
// service.go    Service catalog — what runs and how. Iterated, never named.
// selection.go  CLI flag parsing + dep-graph closure + TUI.
// envfile.go    products/menu/.env + .env.local writers. Composes values
//               from outputs.json + Tofu outputs + statics + minted bytes.
// proc.go       Subprocess + I/O helpers. No business logic.
// resetdb.go    --reset-db scoped reset per database.

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	sel := parseFlags()

	repoRoot := findRepoRoot()
	devTofuDir := filepath.Join(repoRoot, devTofuDirRel)
	menuDir := filepath.Join(repoRoot, menuDirRel)
	envLocalPath := filepath.Join(menuDir, envLocalFileName)
	envPath := filepath.Join(menuDir, envFileName)
	zitadelSAKeyPath := filepath.Join(repoRoot, zitadelSAKeyPathRel)
	zitadelOutputsPath := filepath.Join(repoRoot, zitadelOutputsPathRel)
	zitadelApplyBin := filepath.Join(repoRoot, zitadelApplyBinRel)

	if sel.destroy {
		destroyDevStack(repoRoot, devTofuDir, envLocalPath)
		return
	}
	if sel.resetDB != "" {
		resetDB(sel.resetDB, repoRoot, devTofuDir)
		return
	}

	selected, err := sel.resolve()
	if err != nil {
		fail("%v", err)
	}

	fmt.Printf("%s selection: %s\n", logPrefix, strings.Join(selected, ", "))

	warnEnvLocalState(envLocalPath, selected)

	applyDevStack(selected, devTofuDir, zitadelSAKeyPath, zitadelOutputsPath, zitadelApplyBin)
	writeMenuEnvFiles(devTofuDir, zitadelOutputsPath, envPath, envLocalPath, selected)
	printNextSteps(selected)
}

// applyDevStack runs the 5-step dev choreography:
//
//  1. tofu init
//  2. tofu apply -target=... — bring up containers (postgres, zitadel,
//     openobserve, localstack, house). No menu_env modules, no zitadel
//     provider — those went away in the iac/app split refactor.
//  3. Wait for Zitadel /debug/ready.
//  4. bin/zitadel-apply --no-bws --output-file <path> — reconciles
//     local Zitadel from scratch, writes a JSON file of its 6 outputs.
//  5. (Env file composition is run by the caller via writeMenuEnvFiles,
//     not here.)
func applyDevStack(selected []string, devTofuDir, zitadelSAKeyPath, zitadelOutputsPath, zitadelApplyBin string) {
	enableVars := tfEnableVars(selected)

	step(1, "tofu init")
	runIn(devTofuDir, "tofu", "init", "-upgrade", "-input=false")

	step(2, "tofu apply (containers)")
	// Containers only — postgres, localstack, zitadel, zitadel-login,
	// openobserve, house. No menu container (menu runs via `bun run dev`
	// from products/menu — or as a Stage 4 deploy in a future iteration).
	targets := []string{
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
	}
	pass := append([]string{"apply", "-auto-approve", "-input=false"}, targets...)
	pass = append(pass, enableVars...)
	runIn(devTofuDir, "tofu", pass...)

	step(3, "wait for Zitadel /debug/ready")
	if err := waitForHTTP200(zitadelReadyURL, 90*time.Second); err != nil {
		fail("%v\nhint: docker logs infra-zitadel", err)
	}
	saKey, err := readFileWhenReady(zitadelSAKeyPath)
	if err != nil {
		fail("read %s: %v\nhint: docker logs infra-zitadel", zitadelSAKeyPath, err)
	}

	step(4, "bin/zitadel-apply (Stage 3: reconcile local Zitadel → outputs.json)")
	if err := os.MkdirAll(filepath.Dir(zitadelOutputsPath), 0o700); err != nil {
		fail("mkdir for outputs.json: %v", err)
	}
	// `--no-bws` swaps the bws-backed store for an in-memory one; the
	// orchestrator passes the SA key + reconcile inputs as env vars.
	// Outputs land at zitadelOutputsPath; subsequent runs seed from
	// that file so PAT + signing keys stay stable across `task dev` cycles.
	runInWithEnv(filepath.Dir(zitadelApplyBin),
		[]string{
			"IAC_BOOTSTRAP_ZITADEL_SA_KEY_JSON=" + string(saKey),
			"ZA_BASE_URL=http://localhost:8080",
			"ZA_MENU_HOSTNAME=localhost:3000",
			// Empty ZA_SSH_HOST disables the menu-DNS gate (irrelevant
			// for localhost — no resolver race).
			"ZA_SSH_HOST=",
		},
		zitadelApplyBin, "--no-bws", "--output-file", zitadelOutputsPath)
}

// destroyDevStack tears the dev stack down. Each step is best-effort
// (continues on failure); the dev stack is throwaway by design.
//
// Note: no more state-rm of zitadel_* — those resources don't exist in
// Tofu state anymore (extracted to bin/zitadel-apply). `tofu destroy`
// just walks the container modules + network/volumes.
func destroyDevStack(repoRoot, devTofuDir, envLocalPath string) {
	stepOf(1, destroySteps, "tofu destroy")
	runQuiet(devTofuDir, "tofu", "init", "-input=false")
	runQuiet(devTofuDir, "tofu", "destroy", "-auto-approve")

	stepOf(2, destroySteps, "remove infra-* containers")
	removeInfraContainers()

	stepOf(3, destroySteps, "remove docker network + volumes")
	runQuiet("", "docker", "network", "rm", "iedora")
	runQuiet("", "docker", "volume", "rm", "postgres-data", "localstack-data", "openobserve-data", "zitadel-bootstrap")

	stepOf(4, destroySteps, "wipe local state + outputs + .env.local")
	for _, p := range []string{
		filepath.Join(repoRoot, "infra/dev/.zitadel-bootstrap"),
		filepath.Join(devTofuDir, ".terraform"),
		filepath.Join(devTofuDir, ".terraform.lock.hcl"),
		filepath.Join(devTofuDir, "terraform.tfstate"),
		filepath.Join(devTofuDir, "terraform.tfstate.backup"),
		envLocalPath,
	} {
		if err := os.RemoveAll(p); err != nil {
			warn("remove %s: %v", p, err)
		}
	}

	fmt.Printf("%s dev stack torn down.\n", logPrefix)
}

// tfEnableVars converts the user selection into the `-var enable_X=…`
// flags Tofu expects.
func tfEnableVars(selected []string) []string {
	out := []string{}
	for _, s := range allServices {
		if s.tfVar == "" {
			continue
		}
		out = append(out, "-var", fmt.Sprintf("%s=%t", s.tfVar, contains(selected, s.name)))
	}
	return out
}

// printNextSteps shows the post-apply summary — what URLs each product
// is reachable at. Menu always runs via `bun run dev` from the host in
// the new model (the container path went away with the menu_env Tofu
// module).
func printNextSteps(selected []string) {
	fmt.Println()
	fmt.Printf("%s infra is up.\n", logPrefix)
	if contains(selected, "menu") {
		fmt.Println("  menu: cd products/menu && bun run dev   # hits http://localhost:3000")
	}
	if contains(selected, "house") {
		fmt.Printf("  house (container): %s   # Astro static (busybox httpd)\n",
			composePort(houseContainerName, "80"))
	}
	if !contains(selected, "menu") && !contains(selected, "house") {
		fmt.Println("  (no product selected — infra stays up for ad-hoc work)")
	}
}
