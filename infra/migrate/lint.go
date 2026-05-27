package migrate

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/eduvhc/iedora/internal/mode"
)

// Rule 3 — expansion-only migrations. The menu's drizzle output runs
// in Stage 3 BEFORE Stage 4 swaps the menu container, which means a
// breaking change applied here kills the still-running OLD container
// mid-flight. This lint refuses destructive SQL in live mode unless
// the operator explicitly annotates the statement as the contract
// phase of a three-deploy expand/contract.
//
// See docs/deploy/README.md § Environment guardrails (Rule 3).

// destructivePattern names one class of SQL operation that violates
// "expansion-only" without an opt-in marker. The Pattern field is what
// surfaces in the violation message; Regexp is the actual matcher.
type destructivePattern struct {
	Pattern string
	Regexp  *regexp.Regexp
}

// destructivePatterns is the canonical lint set. Order shapes nothing;
// matches are deduped at violation-emit time.
//
// (?i) — case-insensitive. \b — word boundary so `DROPCOLUMN` doesn't
// match (not real, but reassures the reader the matcher is anchored).
// \s+ — at least one whitespace; drizzle output sometimes uses tabs.
var destructivePatterns = []destructivePattern{
	{Pattern: "DROP COLUMN", Regexp: regexp.MustCompile(`(?i)\bDROP\s+COLUMN\b`)},
	{Pattern: "DROP TABLE", Regexp: regexp.MustCompile(`(?i)\bDROP\s+TABLE\b`)},
	{Pattern: "ALTER COLUMN ... TYPE", Regexp: regexp.MustCompile(`(?i)\bALTER\s+COLUMN\b.*\bTYPE\b`)},
	{Pattern: "RENAME COLUMN", Regexp: regexp.MustCompile(`(?i)\bRENAME\s+COLUMN\b`)},
	{Pattern: "RENAME TABLE", Regexp: regexp.MustCompile(`(?i)\bRENAME\s+TO\b`)},
}

// markerRegexp recognises the inline opt-in. The full grammar:
//
//	-- iedora:expand-contract phase=<expand|migrate-data|contract> [references=<tag>]
//
// Live-mode lint only accepts `phase=contract` with a non-empty
// `references=` value. The other phases are advisory — operator can
// label expand/migrate-data migrations for downstream tooling, but
// they don't unblock destructive statements.
var markerRegexp = regexp.MustCompile(`(?i)--\s*iedora:expand-contract\s+phase=(\w+)(?:\s+references=(\S+))?`)

// statementSeparator is drizzle's per-statement marker. Stable since
// drizzle 0.20+; documented in drizzle-kit's source as the delimiter
// `migrate()` splits on.
const statementSeparator = "--> statement-breakpoint"

// LintViolation is one destructive statement that lacks a valid
// contract marker. Multiple violations per file are possible; the
// caller composes them into a single operator-facing error.
type LintViolation struct {
	File          string // basename, e.g. "0001_drop_better_auth_tables.sql"
	StatementNo   int    // 1-based index within the file
	Pattern       string // from destructivePatterns.Pattern
	StatementHead string // first 80 chars of the offending statement, single-line
	Reason        string // "no marker" | "wrong phase" | "missing references"
}

// LintMigrations scans every `.sql` file in dir (non-recursive — the
// drizzle layout is flat) and returns the destructive statements that
// lack a valid `phase=contract references=...` marker.
//
// Returns: violations + an I/O error. An I/O error short-circuits;
// per-file lint errors are accumulated into the violations slice.
//
// The runMode argument is read by the caller to decide whether
// violations are a hard fail (live) or a warning (local). LintMigrations
// itself is mode-agnostic — it always lists every violation.
func LintMigrations(dir string) ([]LintViolation, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %s: %w", dir, err)
	}

	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		files = append(files, e.Name())
	}
	sort.Strings(files) // numeric prefix → lexicographic == apply-order

	var violations []LintViolation
	for _, name := range files {
		path := filepath.Join(dir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			return violations, fmt.Errorf("read %s: %w", path, err)
		}
		violations = append(violations, lintFileBody(name, string(body))...)
	}
	return violations, nil
}

// lintFileBody is the pure-function core — split the file into
// statements, check each for destructive patterns + (if destructive)
// for a valid contract marker.
func lintFileBody(file, body string) []LintViolation {
	var out []LintViolation

	// drizzle separates statements with `--> statement-breakpoint`. A
	// file with no separator is a single statement (drizzle still
	// emits one terminating `--> statement-breakpoint` on multi-statement
	// files, but single-statement files don't have it).
	statements := strings.Split(body, statementSeparator)

	for i, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}

		// Each destructive pattern is checked independently; one
		// statement can match multiple (e.g. a contrived
		// `DROP TABLE foo; DROP COLUMN bar;` joined into one block).
		seenPatterns := map[string]bool{}
		for _, dp := range destructivePatterns {
			if !dp.Regexp.MatchString(stmt) {
				continue
			}
			if seenPatterns[dp.Pattern] {
				continue
			}
			seenPatterns[dp.Pattern] = true

			reason := classifyMarker(stmt)
			if reason == "" {
				continue // marker valid; no violation
			}
			out = append(out, LintViolation{
				File:          file,
				StatementNo:   i + 1,
				Pattern:       dp.Pattern,
				StatementHead: head(stmt, 80),
				Reason:        reason,
			})
		}
	}
	return out
}

// classifyMarker returns "" when the statement carries a valid
// contract marker, or a short reason string for the violation.
func classifyMarker(stmt string) string {
	m := markerRegexp.FindStringSubmatch(stmt)
	if m == nil {
		return "no `-- iedora:expand-contract` marker"
	}
	phase := strings.ToLower(m[1])
	references := ""
	if len(m) >= 3 {
		references = strings.TrimSpace(m[2])
	}
	if phase != "contract" {
		return fmt.Sprintf("marker phase=%q; destructive statements require phase=contract", phase)
	}
	if references == "" {
		return "marker has phase=contract but no `references=<expand-tag>` field"
	}
	return ""
}

// head returns the first n chars of s, collapsing newlines + runs of
// whitespace so violation lines are single-line in operator output.
func head(s string, n int) string {
	flat := strings.Join(strings.Fields(s), " ")
	if len(flat) <= n {
		return flat
	}
	return flat[:n] + "…"
}

// FormatViolations renders a violations slice into a single
// operator-facing error message. Returns nil when violations is empty.
func FormatViolations(violations []LintViolation) error {
	if len(violations) == 0 {
		return nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Rule 3 (expand-contract) — %d destructive migration statement(s) without a `phase=contract` marker:\n",
		len(violations))
	for _, v := range violations {
		fmt.Fprintf(&b, "  %s stmt %d: %s — %s\n    %s\n",
			v.File, v.StatementNo, v.Pattern, v.Reason, v.StatementHead)
	}
	fmt.Fprint(&b, "\n  Recovery: each destructive statement must be preceded (in the same statement block) by:\n")
	fmt.Fprint(&b, "    -- iedora:expand-contract phase=contract references=<expand-migration-tag>\n")
	fmt.Fprint(&b, "  See docs/deploy/README.md § Environment guardrails (Rule 3).")
	return fmt.Errorf("%s", b.String())
}

// gateMigrations is the mode-aware entry point the orchestrator calls.
// Live: violations are a hard fail. Local: violations are logged to
// stderr but don't block the run (operator iterating on a destructive
// migration shouldn't need to commit + annotate every loop).
func GateMigrations(dir string, runMode mode.Mode) error {
	violations, err := LintMigrations(dir)
	if err != nil {
		return err
	}
	if len(violations) == 0 {
		return nil
	}
	if runMode.IsLive() {
		return FormatViolations(violations)
	}
	// Local: print the violation summary but proceed.
	fmt.Fprintf(os.Stderr, "⚠ menu-db-migrations: %d Rule 3 warning(s) in local mode (would fail in live):\n",
		len(violations))
	for _, v := range violations {
		fmt.Fprintf(os.Stderr, "    %s stmt %d: %s — %s\n", v.File, v.StatementNo, v.Pattern, v.Reason)
	}
	return nil
}
