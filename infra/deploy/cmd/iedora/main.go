// iedora — Stage-3 + Stage-4 orchestrator.
//
//	iedora app apply       — Stage 3: run every app-state configurator.
//	iedora deploy [prods…] — Stage 4: ship one or more product artifacts.
//	iedora destroy [prods…] — Stage 4: undo Stage 4 (per product).
//	iedora doctor          — preflight on the operator's machine.
//
// Stage 2 (IaC) is plain Tofu — `bws run -- tofu -chdir=infra/iac/tofu
// apply`. No subcommand here. Stage 1 (Build & Test) is owned per-
// product and triggered by CI.
//
// The operator invokes this binary via `bws run -- bin/iedora <verb>`
// (or directly, if BWS env is already hydrated).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/eduvhc/iedora/internal/mode"
)

// currentMode pins this binary to Live. `iedora` is the live-side
// orchestrator by design — `cmd/dev` is the local twin. Destructive
// entry points re-assert this with currentMode.Require(mode.Live) as
// belt-and-suspenders: if anyone ever imports this main package or
// flips the constant for local testing, the guard panics on the first
// destructive call rather than silently shelling into production APIs.
// See docs/deploy.md § Environment guardrails (Rule 1).
var currentMode = mode.Live

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	var err error
	switch os.Args[1] {
	case "app":
		err = dispatchApp(ctx, os.Args[2:])
	case "deploy":
		err = runDeployProduct(ctx, os.Args[2:])
	case "destroy":
		err = runDestroyProduct(ctx, os.Args[2:])
	case "doctor":
		err = runDoctor(ctx, os.Args[2:])
	case "-h", "--help", "help":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "iedora: unknown subcommand %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "iedora %s: %v\n", os.Args[1], err)
		os.Exit(1)
	}
}

func dispatchApp(ctx context.Context, argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("app requires a subcommand: apply")
	}
	switch argv[0] {
	case "apply":
		return runAppApply(ctx, argv[1:])
	default:
		return fmt.Errorf("app: unknown subcommand %q (want apply)", argv[0])
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage: iedora <subcommand> [flags]

Stage subcommands:
  app apply             Run every app-state configurator (Stage 3).
  deploy [products…]    Ship product artifacts (Stage 4). Empty list = all.
  destroy [products…]   Tear down product artifacts. Empty list = all.
  doctor                Diagnose deploy-readiness on the operator's machine.

Flags for app apply:
  --ready-budget DUR    Max wait for Zitadel /debug/ready + LE cert (default 6m).
  --only NAME           Run only one configurator by name.

Stage 2 (IaC) is plain Tofu — no subcommand here. Run:
  bws run -- tofu -chdir=infra/iac/tofu init
  bws run -- tofu -chdir=infra/iac/tofu apply
  bws run -- tofu -chdir=infra/iac/tofu destroy

Hydrate BWS env when invoking this binary:
  bws run -- bin/iedora <subcommand>`)
}
