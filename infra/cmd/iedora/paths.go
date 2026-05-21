package main

import (
	"os"
	"path/filepath"
)

// infraDir returns the absolute path to the `infra/` directory. We need
// this to call `tofu -chdir=tofu …` regardless of where the binary was
// invoked from — the operator might run `iedora` from the repo root,
// CI runs it with cwd already at infra, future remote callers may set
// neither. Resolution strategy, in order:
//
//  1. INFRA_DIR env var (highest precedence — CI uses this).
//  2. The current working directory if it contains a `tofu/` subdir
//     (matches how `just infra::deploy` invokes us, since just `cd`s
//     into infra/ for every recipe).
//  3. Walk up from the executable's path looking for a `tofu/` sibling.
//
// Falls back to "." if all three fail; tofu will then emit a clear
// chdir error.
func infraDir() string {
	if d := os.Getenv("INFRA_DIR"); d != "" {
		return d
	}
	if cwd, err := os.Getwd(); err == nil {
		if _, err := os.Stat(filepath.Join(cwd, "tofu")); err == nil {
			return cwd
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 6; i++ {
			if _, err := os.Stat(filepath.Join(dir, "tofu")); err == nil {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "."
}
