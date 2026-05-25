package main

import (
	"strings"
	"testing"

	"github.com/eduvhc/iedora/infra/internal/mode"
)

// TestGuardRecreate covers Rule 5's anti-panic lock: a missing BWS key
// paired with a live Zitadel resource must NOT trigger a silent delete
// + recreate in live mode unless the operator explicitly opted in.
// Local mode always proceeds (recreate is the normal cold-boot path).
func TestGuardRecreate(t *testing.T) {
	cases := []struct {
		name          string
		mode          mode.Mode
		allowRecreate map[string]bool
		resource      string
		wantErr       bool
		wantErrFrags  []string // substrings the error must contain (for operator UX)
	}{
		{
			name:     "local mode always proceeds — pat",
			mode:     mode.Local,
			resource: "pat",
			wantErr:  false,
		},
		{
			name:     "local mode always proceeds — target",
			mode:     mode.Local,
			resource: "target:menu-permissions",
			wantErr:  false,
		},
		{
			name:     "local mode ignores AllowRecreate map",
			mode:     mode.Local,
			// Map empty but local still allowed.
			resource: "pat",
			wantErr:  false,
		},
		{
			name:     "live mode + empty AllowRecreate → refuses",
			mode:     mode.Live,
			resource: "pat",
			wantErr:  true,
			wantErrFrags: []string{
				"Rule 5", // operator can grep
				"anti-panic lock",
				"APP_ZITADEL_MENU_SA_TOKEN", // names the missing BWS key
				"PAT abc123",                // names the live Zitadel resource
				"--allow-recreate=pat",      // tells the operator the exact opt-in
				"docs/deploy.md",            // points at the canonical doc
			},
		},
		{
			name:          "live mode + matching opt-in → proceeds",
			mode:          mode.Live,
			allowRecreate: map[string]bool{"pat": true},
			resource:      "pat",
			wantErr:       false,
		},
		{
			name:          "live mode + wrong opt-in → still refuses",
			mode:          mode.Live,
			allowRecreate: map[string]bool{"target:menu-permissions": true},
			resource:      "pat",
			wantErr:       true,
			wantErrFrags:  []string{"--allow-recreate=pat"},
		},
		{
			name:          "live mode + target opt-in → proceeds for that target",
			mode:          mode.Live,
			allowRecreate: map[string]bool{"target:menu-grants": true},
			resource:      "target:menu-grants",
			wantErr:       false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{
				Mode:          tc.mode,
				AllowRecreate: tc.allowRecreate,
			}
			// Fixed descriptor strings — both gates name the BWS key
			// and a stringified Zitadel resource. PAT-shaped fixture
			// here; the gate is symmetric for targets.
			err := guardRecreate(cfg, tc.resource, "APP_ZITADEL_MENU_SA_TOKEN", "PAT abc123")
			if tc.wantErr {
				if err == nil {
					t.Fatalf("guardRecreate(mode=%s, resource=%s) err = nil, want error", tc.mode, tc.resource)
				}
				for _, frag := range tc.wantErrFrags {
					if !strings.Contains(err.Error(), frag) {
						t.Errorf("guardRecreate error missing substring %q\nfull error: %s", frag, err.Error())
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("guardRecreate(mode=%s, resource=%s) err = %v, want nil", tc.mode, tc.resource, err)
			}
		})
	}
}

// TestParseAllowRecreate covers the comma-split parser feeding the
// AllowRecreate map.
func TestParseAllowRecreate(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want map[string]bool
	}{
		{"empty", "", nil},
		{"only whitespace", "   ", nil},
		{"single", "pat", map[string]bool{"pat": true}},
		{
			"multiple",
			"pat,target:menu-permissions",
			map[string]bool{"pat": true, "target:menu-permissions": true},
		},
		{
			"whitespace around tokens",
			"pat , target:menu-grants ",
			map[string]bool{"pat": true, "target:menu-grants": true},
		},
		{
			"duplicates collapse",
			"pat,pat,pat",
			map[string]bool{"pat": true},
		},
		{
			"empty tokens between commas skipped",
			"pat,,target:menu-grants,",
			map[string]bool{"pat": true, "target:menu-grants": true},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseAllowRecreate(tc.in)
			if !mapEqual(got, tc.want) {
				t.Fatalf("parseAllowRecreate(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func mapEqual(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
