// Local stack orchestrator. Thin shim over `docker compose` —
// translates --only/--except into compose profiles, brings the stack
// up, runs the Stage-3-equivalent `bin/zitadel-apply --mode local`,
// composes products/menu/.env, then starts the menu container.
//
// Replaces the previous Tofu-for-local design (infra/dev/tofu/) per
// docs/deploy.md § Local stack — compose handles every dev concern
// Tofu was bolted onto (network, volumes, profiles for selection,
// depends_on for ordering, healthchecks). Go is only on the path
// for things compose can't natively express: the Zitadel readiness
// probe (distroless image, no healthcheck), the SA-key copy from
// the named volume, and the env-compose-then-restart sequence menu
// needs to receive its post-reconcile env.
//
// All paths resolve relative to the repo root (the `go run` working
// directory is `infra/`; repo root = parent).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/eduvhc/iedora/internal/mode"
)

// currentMode pins this binary to Local. The orchestrator never touches
// BWS, real cloud APIs, or the live infra — see docs/deploy.md
// § Environment guardrails (Rule 1).
var currentMode = mode.Local

func main() {
	currentMode.Require(mode.Local)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	cli := parseFlags()

	repoRoot := findRepoRoot()
	composeDir := filepath.Join(repoRoot, "dev")
	menuDir := filepath.Join(repoRoot, "products/menu")
	envPath := filepath.Join(menuDir, ".env")
	envLocalPath := filepath.Join(menuDir, ".env.local")
	bootstrapDir := filepath.Join(repoRoot, "dev/.zitadel-bootstrap")
	outputsPath := filepath.Join(bootstrapDir, "outputs.json")
	zitadelApplyBin := filepath.Join(repoRoot, "infra/bin/zitadel-apply")

	switch {
	case cli.destroy:
		runDestroy(ctx, composeDir, bootstrapDir, envLocalPath)
		return
	case cli.resetDB != "":
		runResetDB(ctx, cli.resetDB)
		return
	}

	selected, err := cli.resolveSelection()
	if err != nil {
		fail("%v", err)
	}
	fmt.Printf("%s selection: %v\n", logPrefix, selected)

	warnEnvLocalState(envLocalPath, selected)

	// 1. compose up everything EXCEPT menu — menu needs the post-reconcile
	//    env file which doesn't exist yet on a cold run.
	step(1, "docker compose up — infra services")
	composeUp(ctx, composeDir, withoutMenu(selected))

	// 2. Wait for Zitadel /debug/ready. The image is distroless (no sh,
	//    no curl/wget) so we can't ship a docker healthcheck — orchestrator
	//    polls from the host port-forward instead.
	if contains(selected, "zitadel") {
		step(2, "wait for Zitadel /debug/ready")
		if err := waitForHTTP200(ctx, "http://localhost:8080/debug/ready", zitadelReadyBudget); err != nil {
			fail("%v\nhint: docker logs infra-zitadel", err)
		}
	}

	// 3. Run bin/zitadel-apply --mode local. Copies the FirstInstance
	//    SA key out of the zitadel-bootstrap named volume via
	//    `docker cp` (volume has no host bind mount; the orchestrator
	//    just needs the JSON for one process invocation).
	if contains(selected, "zitadel") {
		step(3, "bin/zitadel-apply (reconcile local Zitadel → outputs.json)")
		if err := os.MkdirAll(bootstrapDir, 0o700); err != nil {
			fail("mkdir %s: %v", bootstrapDir, err)
		}
		saKey, err := dockerCp(ctx, "infra-zitadel", "/zitadel-bootstrap/menu-sa.json")
		if err != nil {
			fail("read SA key from infra-zitadel: %v", err)
		}
		runZitadelApply(ctx, zitadelApplyBin, string(saKey), outputsPath)
	}

	// 4. Compose menu's .env from statics + outputs.json + a stable
	//    minted session secret. Skipped services land `<please_fill>`
	//    in .env.local — same pattern the prior Tofu-driven version used.
	step(4, "compose products/menu/.env + .env.local")
	writeMenuEnvFiles(outputsPath, envPath, envLocalPath, selected)

	// 5. Start menu now that .env exists. `compose up -d --wait menu`
	//    picks up the env_file entries on container create.
	if contains(selected, "menu") {
		step(5, "docker compose up — menu")
		composeUp(ctx, composeDir, []string{"menu"})
	}

	printNextSteps(selected)
}
