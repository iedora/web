// Dev container orchestrator. One declarative source (OpenTofu) for
// dev AND prod — `infra/modules/services/*` are the building blocks,
// `infra/dev/tofu/` is the dev root, `infra/tofu/` is the prod root.
// No docker-compose.
//
// Default: bring everything up — `just dev`.
//
// Subset selection (each service is a `enable_*` TF input):
//
//	just dev -i                    interactive TUI per category
//	just dev --only menu           everything menu needs (zitadel + …)
//	just dev --except openobserve  everything else, deps preserved
//	just dev --destroy             tear down the full stack (TUI bypassed)
//
// ─── File layout (one concern per file) ──────────────────────────────
//
// main.go        Entry point: main() + applyDevStack + destroyDevStack.
//                The high-level flow reads as a script.
//
// consts.go      Centralised magic strings — file paths, Tofu output
//                names, annotation tokens. SRP: no logic, just named
//                values. Anything appearing in more than one file (or
//                part of a versioned contract that would be a search-
//                and-replace footgun if duplicated) lives here.
//
// service.go     Service catalog — source of truth for what runs and
//                how. Each entry is self-describing: TF gate, deps,
//                menu env keys it produces. The orchestrator consumes
//                the catalog by iteration, never by name (open/closed
//                principle). Add a service → one entry, no extra wiring.
//
// selection.go   User-facing selection — CLI flags + Charm/huh TUI.
//                Translates operator input into a final []string of
//                service names. The dep-graph closure + except-filter
//                live here because they're part of "interpreting what
//                the user asked for", not part of the catalog or the
//                apply orchestration.
//
// envfile.go     .env / .env.local lifecycle. Contract:
//                  .env       (committed, TF-owned) — every key for a
//                             service currently UP locally; values
//                             are real (Tofu fills dynamic ones).
//                             Excluded-service keys are dropped.
//                  .env.local (gitignored, operator-owned) — place-
//                             holders for excluded services; operator
//                             pastes a homelab/remote URL. Option-2
//                             sync: real values stay, `<please_fill>`
//                             auto-refills from TF, stale keys flagged.
//                Annotations (`# auto: managed`, `# auto: stale`) are
//                orchestrator-managed; everything else passes through
//                verbatim.
//
// proc.go        Process + I/O helpers. No business logic — thin
//                layer for shelling out, capturing output, emitting
//                log lines, and waiting on external signals. Wait
//                helpers prefer push-based signals (docker events as
//                a stream) over polling; the few short-polling paths
//                exist only where the producer doesn't expose a
//                stream.

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

	// --destroy is a separate entry point: no selection resolution, no
	// .env.local sync, no apply. Always a full teardown (matches the
	// throwaway nature of the dev stack — no partial-destroy use case).
	if sel.destroy {
		destroyDevStack(repoRoot, devTofuDir, envLocalPath)
		return
	}

	selected, err := sel.resolve()
	if err != nil {
		fail("%v", err)
	}

	fmt.Printf("%s selection: %s\n", logPrefix, strings.Join(selected, ", "))

	// Surface .env.local state BEFORE the apply so the operator notices
	// shadowing overrides early (rather than after `bun run dev` is
	// already pulling unexpected URLs).
	warnEnvLocalState(envLocalPath, selected)

	applyDevStack(selected, repoRoot, devTofuDir)
	writeMenuEnvFiles(devTofuDir, envPath, envLocalPath, selected)
	printNextSteps(selected)
}

// applyDevStack runs the 4-step Tofu choreography: init, targeted pass
// (containers come up), wait for Zitadel healthy, full apply (seed
// resources + env file outputs). Pulled out of main() so the
// high-level flow reads as a script.
func applyDevStack(selected []string, repoRoot, devTofuDir string) {
	enableVars := tfEnableVars(selected)

	step(1, "tofu init")
	runIn(devTofuDir, "tofu", "init", "-upgrade", "-input=false")

	step(2, "tofu apply -target=... (containers — first pass)")
	// First pass targets the docker resources only. zitadel_* /
	// random_password / module.menu_env need the runtime PAT and
	// aren't part of this pass; targeting keeps stale state from
	// previous failed runs from tripping the apply.
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
	// docker_image.menu builds in parallel with the other resources
	// during the first apply (~30s). The container itself can't come
	// up yet (gated on seed_active, which is false until pass 2).
	//
	// Only target the image when menu is SELECTED. When --except menu,
	// targeting the image without also targeting the container would
	// make tofu plan `docker rmi` while docker_container.menu (gated on
	// seed_active=false in pass 1, so NOT in this -target list) still
	// references it → docker daemon refuses the rmi. Pass 2 (full
	// apply) cleans both up in correct dep order.
	if contains(selected, "menu") {
		targets = append(targets, "-target=docker_image.menu")
	}
	pass1 := append([]string{"apply", "-auto-approve", "-input=false"}, targets...)
	pass1 = append(pass1, enableVars...)
	runIn(devTofuDir, "tofu", pass1...)

	step(3, "wait for Zitadel /debug/ready")
	// Mirror prod: FirstInstance mints a JSON RSA key for the
	// `zitadel-admin-sa` machine user; the TF provider auths with it
	// via `jwt_profile_json`. The `menu-sa` PAT used by the menu app
	// is created by the seed apply as a zitadel_* resource.
	//
	// Probe is two-stage: TCP-dial first (kernel-level, refuses in
	// microseconds while the port is unbound), then HTTP /debug/ready
	// once the port is open. Skips the 500ms-poll-loop pattern entirely
	// — typical detect time is ~50ms past the moment Zitadel actually
	// starts answering.
	if err := waitForHTTP200(zitadelReadyURL, 90*time.Second); err != nil {
		fail("%v\nhint: docker logs infra-zitadel", err)
	}
	jwtPath := filepath.Join(repoRoot, zitadelSAKeyPathRel)
	jwtBytes, err := readFileWhenReady(jwtPath)
	if err != nil {
		fail("read %s: %v\nhint: docker logs infra-zitadel", jwtPath, err)
	}

	step(4, "tofu apply (seed Zitadel + emit env files)")
	pass2 := append([]string{"apply", "-auto-approve", "-input=false"}, enableVars...)
	// JSON is multi-line + contains quotes — passing via TF_VAR env
	// avoids shell-escaping. Same channel prod's `with-secrets` uses
	// for `TF_VAR_infra_zitadel_sa_key_json`.
	runInWithEnv(devTofuDir,
		[]string{tfVarZitadelJWT + "=" + string(jwtBytes)},
		"tofu", pass2...)
}

// destroyDevStack tears the whole dev stack down — symmetric to
// applyDevStack. Each step is best-effort (continues on failure),
// matching the original `just dev-down` shell semantics: the dev
// stack is throwaway by design, partial-state should never block
// a clean reset.
func destroyDevStack(repoRoot, devTofuDir, envLocalPath string) {
	stepOf(1, destroySteps, "tofu state rm zitadel_* + null_resource.iedora_admin_grants")
	// `tofu destroy` refreshes every resource in state via its provider
	// before planning the deletes. The Zitadel provider needs a valid
	// JWT to read the org / project / grants — but mid-destroy the
	// container is going away (or the JWT in state is stale from a
	// previous instance), so the refresh fails with AUTH-7fs1e and
	// blocks the whole destroy. Stripping these from state first
	// removes the need for the API round-trip; the live objects vanish
	// with the Zitadel container below. Best-effort: ignore errors
	// (state may not exist yet, or none of these may be in it).
	stateRmDevZitadel(devTofuDir)

	stepOf(2, destroySteps, "tofu destroy")
	// zitadel_jwt_profile="" satisfies the provider's Configure() check
	// without needing a real JWT. If state is already gone the destroy
	// is a no-op; manual cleanup below catches the rest either way.
	runQuiet(devTofuDir, "tofu", "destroy", "-auto-approve",
		"-var", "zitadel_jwt_profile=",
	)

	stepOf(3, destroySteps, "remove infra-* containers")
	// Catches orphans tofu didn't track (failed apply that never made
	// it into state, e.g. an aborted first-pass).
	removeInfraContainers()

	stepOf(4, destroySteps, "remove docker network + volumes")
	runQuiet("", "docker", "network", "rm", "iedora")
	runQuiet("", "docker", "volume", "rm", "postgres-data", "localstack-data", "openobserve-data")

	stepOf(5, destroySteps, "wipe local state + .env.local")
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
// flags Tofu expects. zitadel is omitted intentionally — see the
// comment on `allServices`; its TF default (true) handles it.
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

// writeMenuEnvFiles emits products/menu/.env (TF-owned) and reconciles
// products/menu/.env.local (operator-owned). Pulled out of main() so
// the post-apply step is a single named call.
func writeMenuEnvFiles(devTofuDir, envPath, envLocalPath string, selected []string) {
	excludedKeys := excludedServiceEndpoints(selected)

	// .env: merge static + dynamic outputs, then drop keys whose
	// backing service was --except'd (no local listener to point at).
	merged := dropEnvKeys(
		mergeEnvFiles(
			captureIn(devTofuDir, "tofu", "output", "-raw", outputEnvCommittable),
			captureIn(devTofuDir, "tofu", "output", "-raw", outputEnvDynamic),
		),
		excludedKeys,
	)
	writeEnvFile(envPath, merged)

	// .env.local: only the excluded keys, as `<please_fill>`. The
	// Option-2 sync auto-fills missing+placeholder keys and preserves
	// any real value the operator has pasted in.
	placeholders := map[string]string{}
	for _, k := range excludedKeys {
		placeholders[k] = placeholderValue
	}
	syncEnvLocal(envLocalPath, excludedKeys, placeholders)
}

// printNextSteps shows the post-apply summary — what URLs each
// product is reachable at. Reads `docker port` for the published
// host port (so a port collision that bumped the container off its
// default still produces a working hint).
func printNextSteps(selected []string) {
	fmt.Println()
	fmt.Printf("%s infra is up.\n", logPrefix)
	if contains(selected, "menu") {
		fmt.Printf("  menu (container):  %s   # same image as prod\n",
			composePort(menuContainerName, "3000"))
		fmt.Println("                     for HMR: just dev --except menu  && cd products/menu && bun run dev")
	}
	if contains(selected, "house") {
		fmt.Printf("  house (container): %s   # Astro static (busybox httpd)\n",
			composePort(houseContainerName, "80"))
	}
	if !contains(selected, "menu") && !contains(selected, "house") {
		fmt.Println("  (no product selected — infra stays up for ad-hoc work)")
	}
}
