package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/eduvhc/iedora/internal/mode"
)

// TestLintFileBody is the pure-function table-driven test for the
// statement-level matcher + marker classifier.
func TestLintFileBody(t *testing.T) {
	cases := []struct {
		name        string
		body        string
		wantCount   int
		wantPattern string // if wantCount == 1
		wantReason  string // substring of LintViolation.Reason
	}{
		{
			name:      "additive only",
			body:      `CREATE TABLE "menu"."foo" ("id" bigserial PRIMARY KEY NOT NULL);`,
			wantCount: 0,
		},
		{
			name:        "drop column without marker fails",
			body:        `ALTER TABLE "menu"."foo" DROP COLUMN "bar";`,
			wantCount:   1,
			wantPattern: "DROP COLUMN",
			wantReason:  "no `-- iedora:expand-contract` marker",
		},
		{
			name: "drop table with valid contract marker passes",
			body: `-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."foo" CASCADE;`,
			wantCount: 0,
		},
		{
			name: "wrong phase rejected",
			body: `-- iedora:expand-contract phase=expand
DROP TABLE "menu"."foo" CASCADE;`,
			wantCount:   1,
			wantPattern: "DROP TABLE",
			wantReason:  `marker phase="expand"`,
		},
		{
			name: "contract phase without references rejected",
			body: `-- iedora:expand-contract phase=contract
DROP TABLE "menu"."foo" CASCADE;`,
			wantCount:   1,
			wantPattern: "DROP TABLE",
			wantReason:  "no `references=<expand-tag>` field",
		},
		{
			name:        "alter column type flagged",
			body:        `ALTER TABLE "menu"."foo" ALTER COLUMN "bar" SET DATA TYPE text;`,
			wantCount:   1,
			wantPattern: "ALTER COLUMN ... TYPE",
		},
		{
			name:        "rename column flagged",
			body:        `ALTER TABLE "menu"."foo" RENAME COLUMN "old" TO "new";`,
			wantCount:   1,
			wantPattern: "RENAME COLUMN",
		},
		{
			name:        "rename table flagged",
			body:        `ALTER TABLE "menu"."foo" RENAME TO "bar";`,
			wantCount:   1,
			wantPattern: "RENAME TABLE",
		},
		{
			name: "multi-statement file: drop in last block, add in first",
			body: `CREATE TABLE "menu"."new" ("id" bigserial PRIMARY KEY);
--> statement-breakpoint
ALTER TABLE "menu"."old" DROP COLUMN "x";`,
			wantCount:   1,
			wantPattern: "DROP COLUMN",
		},
		{
			name: "multi-statement: marker scoped to the block it sits in",
			body: `-- iedora:expand-contract phase=contract references=0003_foo
DROP TABLE "menu"."old" CASCADE;
--> statement-breakpoint
DROP TABLE "menu"."also_old" CASCADE;`,
			// First block: annotated → clean. Second block: no marker → violation.
			wantCount:   1,
			wantPattern: "DROP TABLE",
			wantReason:  "no `-- iedora:expand-contract` marker",
		},
		{
			name:        "case-insensitive matching: lowercase drop table",
			body:        `drop table "menu"."foo" cascade;`,
			wantCount:   1,
			wantPattern: "DROP TABLE",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := lintFileBody("test.sql", tc.body)
			if len(got) != tc.wantCount {
				t.Fatalf("lintFileBody → %d violations, want %d\nviolations: %+v", len(got), tc.wantCount, got)
			}
			if tc.wantCount == 1 {
				if got[0].Pattern != tc.wantPattern {
					t.Errorf("Pattern = %q, want %q", got[0].Pattern, tc.wantPattern)
				}
				if tc.wantReason != "" && !strings.Contains(got[0].Reason, tc.wantReason) {
					t.Errorf("Reason = %q, want substring %q", got[0].Reason, tc.wantReason)
				}
			}
		})
	}
}

// TestLintMigrations exercises the dir-scanning path against a tmpdir
// holding a handful of fixture files. Mirrors the real drizzle layout
// (flat `.sql` files, `meta/` ignored).
func TestLintMigrations(t *testing.T) {
	dir := t.TempDir()
	mustWrite := func(name, body string) {
		t.Helper()
		if err := writeFile(filepath.Join(dir, name), body); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("0000_init.sql", `CREATE TABLE "menu"."a" ("id" bigserial PRIMARY KEY);`)
	mustWrite("0001_drop.sql", `DROP TABLE "menu"."a" CASCADE;`)
	mustWrite("0002_annotated.sql", `-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."b" CASCADE;`)
	mustWrite("notes.txt", "ignored — not .sql")
	// `meta/` subdir is excluded by IsDir() check.
	if err := mkdirAll(filepath.Join(dir, "meta")); err != nil {
		t.Fatal(err)
	}
	mustWrite("meta/_journal.json", `{}`)

	violations, err := LintMigrations(dir)
	if err != nil {
		t.Fatalf("LintMigrations err = %v", err)
	}
	if len(violations) != 1 {
		t.Fatalf("LintMigrations → %d violations, want 1\n%+v", len(violations), violations)
	}
	if violations[0].File != "0001_drop.sql" {
		t.Errorf("File = %q, want 0001_drop.sql", violations[0].File)
	}
}

// TestGateMigrations covers the mode-aware shim — live returns an
// error on violations, local returns nil (and logs).
func TestGateMigrations(t *testing.T) {
	dir := t.TempDir()
	mustWrite := func(name, body string) {
		t.Helper()
		if err := writeFile(filepath.Join(dir, name), body); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("0001_drop.sql", `DROP TABLE "menu"."a" CASCADE;`)

	if err := gateMigrations(dir, mode.Live); err == nil {
		t.Fatal("gateMigrations(live) = nil, want error")
	} else if !strings.Contains(err.Error(), "Rule 3") {
		t.Errorf("error does not name the rule: %v", err)
	}

	if err := gateMigrations(dir, mode.Local); err != nil {
		t.Errorf("gateMigrations(local) = %v, want nil (local warns only)", err)
	}
}

// TestFormatViolationsEmpty — the empty-input path returns nil so
// callers don't need to guard the call.
func TestFormatViolationsEmpty(t *testing.T) {
	if err := FormatViolations(nil); err != nil {
		t.Errorf("FormatViolations(nil) = %v, want nil", err)
	}
}

// TestLintRealMigrations is an integration check against the actual
// drizzle directory in the repo. Catches retroactive-annotation drift
// — if someone removes the contract marker from
// `0001_drop_better_auth_tables.sql`, this test fails before the
// destructive migration runs in live.
//
// Skips if the drizzle directory isn't found relative to the test
// binary (so CI in a non-monorepo checkout doesn't false-fail).
func TestLintRealMigrations(t *testing.T) {
	// `app-state/menu-db-migrations/` → repo root = `../../..`
	dir := filepath.Join("..", "..", "..", "products", "menu", "drizzle")
	if _, err := os.Stat(dir); err != nil {
		t.Skipf("real drizzle dir not at %s: %v", dir, err)
	}
	violations, err := LintMigrations(dir)
	if err != nil {
		t.Fatalf("LintMigrations: %v", err)
	}
	if len(violations) > 0 {
		t.Errorf("real drizzle migrations are not lint-clean (got %d violations):", len(violations))
		for _, v := range violations {
			t.Errorf("  %s stmt %d: %s — %s", v.File, v.StatementNo, v.Pattern, v.Reason)
		}
	}
}

// --- test helpers ---

func writeFile(path, body string) error {
	return os.WriteFile(path, []byte(body), 0o600)
}
func mkdirAll(path string) error {
	return os.MkdirAll(path, 0o700)
}
