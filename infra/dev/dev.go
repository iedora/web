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
//
// Each file in this package owns one concern:
//
//	consts.go      magic strings / paths / timing
//	service.go     catalog + dep graph
//	selection.go   CLI flags / TUI
//	envfile.go     .env + .env.local lifecycle
//	proc.go        exec + wait + log helpers
//	dev.go         main() + applyDevStack (this file)

package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	sel := parseFlags()
	selected, err := sel.resolve()
	if err != nil {
		fail("%v", err)
	}

	repoRoot := findRepoRoot()
	devTofuDir := filepath.Join(repoRoot, devTofuDirRel)
	menuDir := filepath.Join(repoRoot, menuDirRel)
	envLocalPath := filepath.Join(menuDir, envLocalFileName)
	envPath := filepath.Join(menuDir, envFileName)

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
	pass1 := append([]string{
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
		// during the first apply (~30s). The container itself can't
		// come up yet (depends on the zitadel seed) — it lands in
		// pass 2.
		"-target=docker_image.menu",
	}, enableVars...)
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
