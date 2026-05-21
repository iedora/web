package main

import (
	"flag"
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
)

// selection captures the post-parse CLI flags. Lets main() pass one
// value around instead of three positionals.
type selection struct {
	interactive bool
	only        string
	except      string
	destroy     bool
}

// parseFlags reads the CLI flags into a typed value. No defaults
// magic — the zero value of selection is the implicit "default
// everything" path handled by resolveSelection.
func parseFlags() selection {
	sel := selection{}
	flag.BoolVar(&sel.interactive, "i", false, "interactive selection (TUI per category)")
	flag.BoolVar(&sel.interactive, "interactive", false, "alias for -i")
	flag.StringVar(&sel.only, "only", "", "comma-separated services to start (+ their deps); skips everything else")
	flag.StringVar(&sel.except, "except", "", "comma-separated services to skip; everything else (+ their deps) starts")
	flag.BoolVar(&sel.destroy, "destroy", false, "tear down the dev stack: tofu destroy + remove infra-* containers + remove docker network + wipe volumes + wipe bootstrap dir + wipe tfstate + wipe .env.local. Ignores --only/--except (always full teardown).")
	flag.Parse()
	return sel
}

// resolve maps the raw CLI flags to the final service list, applying
// the dep-graph closure and the --except filter. Returns the empty
// case as an error rather than silently no-oping the apply.
func (sel selection) resolve() ([]string, error) {
	picked, err := sel.pick()
	if err != nil {
		return nil, err
	}
	picked = expandDeps(picked)
	if sel.except != "" {
		blocked := map[string]bool{}
		for _, n := range splitCSV(sel.except) {
			blocked[n] = true
		}
		filtered := picked[:0]
		for _, n := range picked {
			if !blocked[n] {
				filtered = append(filtered, n)
			}
		}
		picked = filtered
	}
	if len(picked) == 0 {
		return nil, fmt.Errorf("empty selection — pick at least one service")
	}
	return picked, nil
}

// pick returns the initial selection before dep-expansion / except-
// filtering. Either the interactive TUI's result, the `--only` list,
// the `--except` complement, or the default (everything).
func (sel selection) pick() ([]string, error) {
	if sel.interactive {
		return runTUI()
	}
	if sel.only != "" && sel.except != "" {
		return nil, fmt.Errorf("--only and --except are mutually exclusive")
	}
	if sel.only != "" {
		return splitCSV(sel.only), nil
	}
	if sel.except != "" {
		// Default to everything; the dep-expansion + except-filter in
		// .resolve() removes the named services + their unreachable deps.
		excluded := map[string]bool{}
		for _, n := range splitCSV(sel.except) {
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

// runTUI shows a per-category multi-select form. All entries start
// pre-checked — the operator deselects what they don't want, instead
// of building the selection from scratch.
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
