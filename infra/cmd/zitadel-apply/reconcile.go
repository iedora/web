package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Reconcile runs the full app-state reconcile against the live Zitadel.
// Idempotent. Designed to run on every `iedora app apply` invocation;
// re-runs are no-ops when the live state already matches.
//
// Failure modes are explicit per resource — see the per-reconcile-fn
// docs for the (bws-has, zitadel-has) recovery branches.
type Config struct {
	BaseURL       string   // "https://auth.iedora.com" or "http://localhost:8080"
	SAKeyJSON     string   // FirstInstance-minted SA key
	MenuHostname  string   // for action target endpoint URLs
	AdminEmails   []string // emails to grant iedora-admin to
	SSHHost       string   // Hetzner IPv4 for the menu DNS probe; empty in dev (no SSH target)
	GrantsOnly    bool     // if true, skip full reconcile and only run admin grant pass
	MenuDNSBudget time.Duration

	// Store is where reconciled values (PAT, signing keys, OIDC creds,
	// project id) are persisted + looked up on subsequent runs. Two
	// implementations live in store.go:
	//   - bwsStore   prod default
	//   - memoryStore dev / `--no-bws` mode (optionally serialises to JSON)
	Store secretStore
}

// State accumulates the IDs + one-shot secret values produced across the
// reconcile. Written to BWS at the END of the run (after all resources
// land) — except PAT + signing keys, which are written IMMEDIATELY on
// creation so a crash never orphans a one-shot reveal.
type State struct {
	OrgID                  string
	ProjectID              string
	MachineUserID          string
	OIDCAppID              string
	OIDCClientID           string
	OIDCClientSecret       string
	PATID                  string
	PATToken               string
	PermissionsTargetID    string
	PermissionsSigningKey  string
	GrantsTargetID         string
	GrantsSigningKey       string

	// Set when an existing resource was deleted-and-recreated because
	// BWS was missing the one-shot value. Drives the loud warning at the
	// end of the run.
	recreatedMessages []string
}

// Reconcile is the top-level entry called by main.go. Returns the final
// state for printing + the error if any step failed.
func Reconcile(ctx context.Context, c *client, cfg Config) (*State, error) {
	s := &State{}

	if cfg.GrantsOnly {
		// --grants-only path: short-circuit to the admin-email grant pass.
		// Requires only org + project + role + the admin token (we have
		// the SA key; the project/org IDs we look up live).
		if err := reconcileOrg(ctx, c, s); err != nil {
			return s, err
		}
		if err := reconcileProject(ctx, c, s); err != nil {
			return s, err
		}
		return s, reconcileAdminGrants(ctx, c, s, cfg.AdminEmails)
	}

	steps := []struct {
		name string
		fn   func() error
	}{
		{"org", func() error { return reconcileOrg(ctx, c, s) }},
		{"project", func() error { return reconcileProject(ctx, c, s) }},
		{"project-roles", func() error { return reconcileProjectRoles(ctx, c, s) }},
		{"machine-user", func() error { return reconcileMachineUser(ctx, c, s) }},
		{"iam-owner-grant", func() error { return reconcileIAMOwner(ctx, c, s) }},
		{"pat", func() error { return reconcilePAT(ctx, c, s, cfg) }},
		{"menu-dns-wait", func() error { return waitForMenuDNS(ctx, cfg.SSHHost, cfg.MenuDNSBudget) }},
		{"action-targets", func() error { return reconcileActionTargets(ctx, c, s, cfg) }},
		{"action-executions", func() error { return reconcileExecutions(ctx, c, s) }},
		{"oidc-app", func() error { return reconcileOIDCApp(ctx, c, s, cfg) }},
		{"persist-outputs", func() error { return writeOutputs(ctx, cfg.Store, s) }},
		{"admin-grants", func() error { return reconcileAdminGrants(ctx, c, s, cfg.AdminEmails) }},
	}
	for _, step := range steps {
		fmt.Fprintf(stderr, "→ %s\n", step.name)
		if err := step.fn(); err != nil {
			return s, fmt.Errorf("%s: %w", step.name, err)
		}
	}

	for _, msg := range s.recreatedMessages {
		fmt.Fprintln(stderr, "  ⚠ "+msg)
	}
	return s, nil
}

// ── Org ──────────────────────────────────────────────────────────────────────

func reconcileOrg(ctx context.Context, c *client, s *State) error {
	// Org is created by Zitadel's FirstInstance step on first boot — we
	// only ever look it up. If it's missing, the deploy is broken
	// upstream of this binary.
	id, err := findOrgByName(ctx, c, orgName)
	if err != nil {
		return err
	}
	if id == "" {
		return fmt.Errorf("org %q not found — FirstInstance bootstrap may have failed; check `docker logs infra-zitadel`", orgName)
	}
	s.OrgID = id
	return nil
}

type searchOrgsReq struct {
	Queries []orgQuery `json:"queries"`
}
type orgQuery struct {
	NameQuery *nameQuery `json:"nameQuery,omitempty"`
}
type nameQuery struct {
	Name   string `json:"name"`
	Method string `json:"method"`
}
type searchOrgsResp struct {
	Result []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"result"`
}

func findOrgByName(ctx context.Context, c *client, name string) (string, error) {
	body, status, err := c.do(ctx, http.MethodPost, "/v2/organizations/_search",
		searchOrgsReq{Queries: []orgQuery{{NameQuery: &nameQuery{Name: name, Method: "TEXT_QUERY_METHOD_EQUALS"}}}},
		requestOpts{})
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("search orgs HTTP %d: %s", status, string(body))
	}
	var out searchOrgsResp
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode search orgs: %w (body: %s)", err, string(body))
	}
	for _, o := range out.Result {
		if o.Name == name {
			return o.ID, nil
		}
	}
	return "", nil
}

// ── Project ──────────────────────────────────────────────────────────────────

func reconcileProject(ctx context.Context, c *client, s *State) error {
	id, err := findProjectByName(ctx, c, s.OrgID, projectName)
	if err != nil {
		return err
	}
	if id == "" {
		// Create.
		var resp struct {
			ID string `json:"id"`
		}
		if err := c.doJSON(ctx, http.MethodPost, "/management/v1/projects", map[string]any{
			"name":                   projectName,
			"projectRoleAssertion":   true,
			"projectRoleCheck":       false,
			"hasProjectCheck":        false,
		}, &resp, requestOpts{orgID: s.OrgID}); err != nil {
			return fmt.Errorf("create project: %w", err)
		}
		s.ProjectID = resp.ID
		return nil
	}
	s.ProjectID = id
	// Ensure projectRoleAssertion is on (idempotent update — Zitadel
	// returns 200 with no diff if already set).
	if err := c.doJSON(ctx, http.MethodPut, "/management/v1/projects/"+id, map[string]any{
		"name":                   projectName,
		"projectRoleAssertion":   true,
		"projectRoleCheck":       false,
		"hasProjectCheck":        false,
	}, nil, requestOpts{orgID: s.OrgID}); err != nil {
		return fmt.Errorf("update project: %w", err)
	}
	return nil
}

type searchProjectsResp struct {
	Result []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"result"`
}

func findProjectByName(ctx context.Context, c *client, orgID, name string) (string, error) {
	body, status, err := c.do(ctx, http.MethodPost, "/management/v1/projects/_search",
		map[string]any{
			"queries": []any{
				map[string]any{"nameQuery": map[string]any{
					"name":   name,
					"method": "PROJECT_NAME_QUERY_METHOD_EQUALS",
				}},
			},
		},
		requestOpts{orgID: orgID})
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("search projects HTTP %d: %s", status, string(body))
	}
	var out searchProjectsResp
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode search projects: %w (body: %s)", err, string(body))
	}
	for _, p := range out.Result {
		if p.Name == name {
			return p.ID, nil
		}
	}
	return "", nil
}

// ── Project roles ────────────────────────────────────────────────────────────

func reconcileProjectRoles(ctx context.Context, c *client, s *State) error {
	existing, err := listProjectRoles(ctx, c, s.OrgID, s.ProjectID)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, k := range existing {
		have[k] = true
	}
	for _, r := range projectRoles {
		if have[r.key] {
			// Update (idempotent — no diff = no error).
			if err := c.doJSON(ctx, http.MethodPut,
				"/management/v1/projects/"+s.ProjectID+"/roles/"+r.key,
				map[string]any{
					"displayName": r.displayName,
					"group":       r.group,
				}, nil, requestOpts{orgID: s.OrgID}); err != nil {
				return fmt.Errorf("update role %s: %w", r.key, err)
			}
			continue
		}
		err := c.doJSON(ctx, http.MethodPost,
			"/management/v1/projects/"+s.ProjectID+"/roles",
			map[string]any{
				"roleKey":     r.key,
				"displayName": r.displayName,
				"group":       r.group,
			}, nil, requestOpts{orgID: s.OrgID})
		if err != nil && !errors.Is(err, ErrAlreadyExists) {
			return fmt.Errorf("create role %s: %w", r.key, err)
		}
	}
	return nil
}

func listProjectRoles(ctx context.Context, c *client, orgID, projectID string) ([]string, error) {
	body, status, err := c.do(ctx, http.MethodPost,
		"/management/v1/projects/"+projectID+"/roles/_search",
		map[string]any{}, requestOpts{orgID: orgID})
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("list roles HTTP %d: %s", status, string(body))
	}
	var out struct {
		Result []struct {
			Key string `json:"key"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode list roles: %w", err)
	}
	keys := make([]string, 0, len(out.Result))
	for _, r := range out.Result {
		keys = append(keys, r.Key)
	}
	return keys, nil
}

// ── Machine user ─────────────────────────────────────────────────────────────

func reconcileMachineUser(ctx context.Context, c *client, s *State) error {
	id, err := findUserByUsername(ctx, c, s.OrgID, menuSAUsername)
	if err != nil {
		return err
	}
	if id != "" {
		s.MachineUserID = id
		return nil
	}
	var resp struct {
		UserID string `json:"userId"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/management/v1/users/machine",
		map[string]any{
			"userName":        menuSAUsername,
			"name":            menuSAName,
			"description":     menuSADescription,
			"accessTokenType": "ACCESS_TOKEN_TYPE_BEARER",
		}, &resp, requestOpts{orgID: s.OrgID}); err != nil {
		return fmt.Errorf("create machine user: %w", err)
	}
	s.MachineUserID = resp.UserID
	return nil
}

func findUserByUsername(ctx context.Context, c *client, orgID, username string) (string, error) {
	body, status, err := c.do(ctx, http.MethodPost, "/v2/users",
		map[string]any{
			"queries": []any{
				map[string]any{"userNameQuery": map[string]any{
					"userName": username,
					"method":   "TEXT_QUERY_METHOD_EQUALS",
				}},
			},
		}, requestOpts{orgID: orgID})
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("search users HTTP %d: %s", status, string(body))
	}
	var out struct {
		Result []struct {
			UserID string `json:"userId"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode search users: %w", err)
	}
	if len(out.Result) == 0 {
		return "", nil
	}
	return out.Result[0].UserID, nil
}

// ── IAM owner grant ──────────────────────────────────────────────────────────

func reconcileIAMOwner(ctx context.Context, c *client, s *State) error {
	// Try POST; on ALREADY_EXISTS treat as success.
	err := c.doJSON(ctx, http.MethodPost, "/admin/v1/members",
		map[string]any{
			"userId": s.MachineUserID,
			"roles":  []string{"IAM_OWNER"},
		}, nil, requestOpts{})
	if err == nil || errors.Is(err, ErrAlreadyExists) {
		// Ensure roles match in case the grant existed with a different role set.
		_ = c.doJSON(ctx, http.MethodPut, "/admin/v1/members/"+s.MachineUserID,
			map[string]any{"roles": []string{"IAM_OWNER"}}, nil, requestOpts{})
		return nil
	}
	return fmt.Errorf("add IAM_OWNER member: %w", err)
}

// ── PAT ──────────────────────────────────────────────────────────────────────

func reconcilePAT(ctx context.Context, c *client, s *State, cfg Config) error {
	// Discover store state + Zitadel state.
	bwsTok, hasBWS, err := cfg.Store.Read(ctx, bwsKeyMenuSAToken)
	if err != nil {
		return err
	}
	existingPATs, err := listPATs(ctx, c, s.OrgID, s.MachineUserID)
	if err != nil {
		return err
	}

	// Concurrent-operator guard: a single PAT is normal; >1 means a prior
	// run crashed mid-create or two operators raced. We can't tell which
	// is the store-recorded one (PATs don't carry a tag), so bail loudly
	// instead of silently deleting the wrong one.
	if len(existingPATs) > 1 {
		return fmt.Errorf("found %d PATs on machine user %q (expected 0 or 1) — operator must reconcile manually via Zitadel UI before re-running", len(existingPATs), menuSAUsername)
	}

	hasZitadel := len(existingPATs) == 1

	switch {
	case !hasBWS && !hasZitadel:
		return createPATAndStore(ctx, c, s, cfg)
	case hasBWS && hasZitadel:
		// Trust the store. We can't verify "the stored token matches this
		// PAT id" without an introspection endpoint that doesn't echo the
		// token, so we just record the existing PAT id + token.
		s.PATID = existingPATs[0]
		s.PATToken = bwsTok
		return nil
	case !hasBWS && hasZitadel:
		// One-shot reveal was lost. Delete + recreate. Loud warning at
		// the end of the run.
		if err := c.doJSON(ctx, http.MethodDelete,
			"/management/v1/users/"+s.MachineUserID+"/pats/"+existingPATs[0],
			nil, nil, requestOpts{orgID: s.OrgID}); err != nil {
			return fmt.Errorf("delete stale PAT %s: %w", existingPATs[0], err)
		}
		s.recreatedMessages = append(s.recreatedMessages,
			"PAT was recreated (store lacked APP_ZITADEL_MENU_SA_TOKEN — old PAT invalidated). Restart menu container to pick up the new token.")
		return createPATAndStore(ctx, c, s, cfg)
	case hasBWS && !hasZitadel:
		// Zitadel was wiped underneath us. Drop the stale store key and
		// mint a new one.
		_ = cfg.Store.Delete(ctx, bwsKeyMenuSAToken)
		s.recreatedMessages = append(s.recreatedMessages,
			"PAT was created from scratch (Zitadel had no PAT but store had a stale token).")
		return createPATAndStore(ctx, c, s, cfg)
	}
	return nil
}

func createPATAndStore(ctx context.Context, c *client, s *State, cfg Config) error {
	var resp struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if err := c.doJSON(ctx, http.MethodPost,
		"/management/v1/users/"+s.MachineUserID+"/pats",
		map[string]any{"expirationDate": menuSAPATExpiry},
		&resp, requestOpts{orgID: s.OrgID}); err != nil {
		return fmt.Errorf("create PAT: %w", err)
	}
	if resp.Token == "" {
		return fmt.Errorf("create PAT returned empty token (unexpected — re-run)")
	}
	s.PATID = resp.ID
	s.PATToken = resp.Token
	// Immediate write-through — a crash after this point leaves a
	// recoverable token in the store, not an orphan.
	if err := cfg.Store.Write(ctx, bwsKeyMenuSAToken, resp.Token); err != nil {
		return fmt.Errorf("store write %s: %w", bwsKeyMenuSAToken, err)
	}
	return nil
}

func listPATs(ctx context.Context, c *client, orgID, userID string) ([]string, error) {
	body, status, err := c.do(ctx, http.MethodPost,
		"/management/v1/users/"+userID+"/pats/_search",
		map[string]any{}, requestOpts{orgID: orgID})
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("list PATs HTTP %d: %s", status, string(body))
	}
	var out struct {
		Result []struct {
			ID string `json:"id"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode list PATs: %w", err)
	}
	ids := make([]string, 0, len(out.Result))
	for _, p := range out.Result {
		ids = append(ids, p.ID)
	}
	return ids, nil
}

// ── Action targets ───────────────────────────────────────────────────────────

func reconcileActionTargets(ctx context.Context, c *client, s *State, cfg Config) error {
	if err := reconcileOneTarget(ctx, c, s, cfg, menuPermissionsTargetName, menuPermissionsPath,
		&s.PermissionsTargetID, &s.PermissionsSigningKey, bwsKeyPermissionsSigningKey); err != nil {
		return err
	}
	if err := reconcileOneTarget(ctx, c, s, cfg, menuGrantsTargetName, menuGrantsPath,
		&s.GrantsTargetID, &s.GrantsSigningKey, bwsKeyGrantsSigningKey); err != nil {
		return err
	}
	return nil
}

func reconcileOneTarget(ctx context.Context, c *client, s *State, cfg Config,
	name, path string, idOut, signingKeyOut *string, bwsKey string) error {

	bwsVal, hasBWS, err := cfg.Store.Read(ctx, bwsKey)
	if err != nil {
		return err
	}
	existing, err := findTargetByName(ctx, c, name)
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://%s%s", cfg.MenuHostname, path)

	switch {
	case existing == "" && !hasBWS:
		return createTargetAndStore(ctx, c, cfg, name, endpoint, idOut, signingKeyOut, bwsKey)
	case existing != "" && hasBWS:
		// v2 actions API uses POST for update (not PATCH) — see proto's
		// `option (google.api.http) = { post: "/v2/actions/targets/{id}" }`.
		_ = c.doJSON(ctx, http.MethodPost, "/v2/actions/targets/"+existing,
			targetBody(name, endpoint), nil, requestOpts{})
		*idOut = existing
		*signingKeyOut = bwsVal
		return nil
	case existing != "" && !hasBWS:
		// One-shot reveal lost — delete + recreate. Dependent executions
		// (bound by target ID) get rebound by reconcileExecutions next.
		if err := c.doJSON(ctx, http.MethodDelete, "/v2/actions/targets/"+existing,
			nil, nil, requestOpts{}); err != nil {
			return fmt.Errorf("delete stale target %s: %w", existing, err)
		}
		s.recreatedMessages = append(s.recreatedMessages,
			fmt.Sprintf("target %s was recreated (store lacked %s — bindings rebuilt)", name, bwsKey))
		return createTargetAndStore(ctx, c, cfg, name, endpoint, idOut, signingKeyOut, bwsKey)
	case existing == "" && hasBWS:
		_ = cfg.Store.Delete(ctx, bwsKey)
		s.recreatedMessages = append(s.recreatedMessages,
			fmt.Sprintf("target %s was created from scratch (Zitadel had no target but store had a stale key)", name))
		return createTargetAndStore(ctx, c, cfg, name, endpoint, idOut, signingKeyOut, bwsKey)
	}
	return nil
}

func targetBody(name, endpoint string) map[string]any {
	return map[string]any{
		"name": name,
		"restCall": map[string]any{
			"interruptOnError": targetInterruptOnError,
		},
		"endpoint": endpoint,
		"timeout":  targetTimeout,
	}
}

func createTargetAndStore(ctx context.Context, c *client, cfg Config,
	name, endpoint string, idOut, signingKeyOut *string, bwsKey string) error {
	var resp struct {
		ID         string `json:"id"`
		SigningKey string `json:"signingKey"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/v2/actions/targets",
		targetBody(name, endpoint), &resp, requestOpts{}); err != nil {
		return fmt.Errorf("create target %s: %w", name, err)
	}
	if resp.SigningKey == "" {
		return fmt.Errorf("create target %s returned empty signingKey", name)
	}
	*idOut = resp.ID
	*signingKeyOut = resp.SigningKey
	if err := cfg.Store.Write(ctx, bwsKey, resp.SigningKey); err != nil {
		return fmt.Errorf("store write %s: %w", bwsKey, err)
	}
	return nil
}

func findTargetByName(ctx context.Context, c *client, name string) (string, error) {
	// Filter by name. Could send `{}` to list all, but per-name filter
	// keeps the response small even when more targets land in future.
	body, status, err := c.do(ctx, http.MethodPost, "/v2/actions/targets/search",
		map[string]any{
			"filters": []any{
				map[string]any{
					"targetNameFilter": map[string]any{
						"targetName": name,
						"method":     "TEXT_FILTER_METHOD_EQUALS",
					},
				},
			},
		}, requestOpts{})
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("search targets HTTP %d: %s", status, string(body))
	}
	// Response shape: `{ pagination, targets: [{id, name, ...}] }`.
	// The `result` field is reserved in the proto and not used.
	var out struct {
		Targets []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode search targets: %w", err)
	}
	for _, t := range out.Targets {
		if t.Name == name {
			return t.ID, nil
		}
	}
	return "", nil
}

// ── Action executions ────────────────────────────────────────────────────────

func reconcileExecutions(ctx context.Context, c *client, s *State) error {
	// Permissions target: bind to preuserinfo + preaccesstoken functions.
	for _, fn := range menuPermissionsFunctions {
		if err := setFunctionExecution(ctx, c, fn, s.PermissionsTargetID); err != nil {
			return fmt.Errorf("set function %s execution: %w", fn, err)
		}
	}
	// Grants target: bind to user.grant.* events.
	for _, ev := range menuGrantEvents {
		if err := setEventExecution(ctx, c, ev, s.GrantsTargetID); err != nil {
			return fmt.Errorf("set event %s execution: %w", ev, err)
		}
	}
	return nil
}

// Note on shape: Condition is a `oneof condition_type` with `function`
// as a top-level case (NOT nested under `response`). Targets is a
// `repeated string` of target IDs — NOT a list of {target: id} objects
// despite what the proto's openapiv2_schema example claims. The 400
// `invalid value for string field targets: {` we got on first cold
// deploy is what tipped this off.
func setFunctionExecution(ctx context.Context, c *client, fn, targetID string) error {
	return c.doJSON(ctx, http.MethodPut, "/v2/actions/executions",
		map[string]any{
			"condition": map[string]any{
				"function": map[string]any{"name": fn},
			},
			"targets": []string{targetID},
		}, nil, requestOpts{})
}

func setEventExecution(ctx context.Context, c *client, event, targetID string) error {
	return c.doJSON(ctx, http.MethodPut, "/v2/actions/executions",
		map[string]any{
			"condition": map[string]any{
				"event": map[string]any{"event": event},
			},
			"targets": []string{targetID},
		}, nil, requestOpts{})
}

// ── OIDC app ─────────────────────────────────────────────────────────────────

func reconcileOIDCApp(ctx context.Context, c *client, s *State, cfg Config) error {
	storedID, hasStoredID, err := cfg.Store.Read(ctx, bwsKeyOIDCClientID)
	if err != nil {
		return err
	}
	_, hasStoredSecret, err := cfg.Store.Read(ctx, bwsKeyOIDCClientSecret)
	if err != nil {
		return err
	}
	existingAppID, existingClientID, err := findAppByName(ctx, c, s.OrgID, s.ProjectID, menuAppName)
	if err != nil {
		return err
	}

	if existingAppID == "" {
		// Cold create.
		appID, clientID, clientSecret, err := createOIDCApp(ctx, c, s, cfg)
		if err != nil {
			return err
		}
		s.OIDCAppID = appID
		s.OIDCClientID = clientID
		s.OIDCClientSecret = clientSecret
		if err := cfg.Store.Write(ctx, bwsKeyOIDCClientID, clientID); err != nil {
			return err
		}
		return cfg.Store.Write(ctx, bwsKeyOIDCClientSecret, clientSecret)
	}

	s.OIDCAppID = existingAppID
	s.OIDCClientID = existingClientID

	// Update redirect URIs etc — idempotent.
	if err := updateOIDCApp(ctx, c, s, cfg); err != nil {
		return err
	}

	// client_id flowed through; ensure store matches.
	if !hasStoredID || storedID != existingClientID {
		if err := cfg.Store.Write(ctx, bwsKeyOIDCClientID, existingClientID); err != nil {
			return err
		}
	}

	// client_secret: regenerate if store is missing it. Zitadel exposes
	// `POST .../secret` which returns a fresh secret each call — that's
	// our recovery path for "store was wiped but app still exists".
	if !hasStoredSecret {
		secret, err := regenerateOIDCSecret(ctx, c, s)
		if err != nil {
			return fmt.Errorf("regenerate OIDC secret: %w", err)
		}
		s.OIDCClientSecret = secret
		s.recreatedMessages = append(s.recreatedMessages,
			"OIDC client_secret was regenerated (store lacked APP_ZITADEL_MENU_OIDC_CLIENT_SECRET — restart menu container)")
		return cfg.Store.Write(ctx, bwsKeyOIDCClientSecret, secret)
	}
	return nil
}

func oidcAppBody(menuHostname, zitadelHostname string) map[string]any {
	return map[string]any{
		"name":                     menuAppName,
		"redirectUris":             []string{fmt.Sprintf("https://%s/api/auth/callback", menuHostname)},
		"postLogoutRedirectUris":   []string{fmt.Sprintf("https://%s/", menuHostname)},
		"responseTypes":            []string{"OIDC_RESPONSE_TYPE_CODE"},
		"grantTypes":               []string{"OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"},
		"appType":                  "OIDC_APP_TYPE_WEB",
		"authMethodType":           "OIDC_AUTH_METHOD_TYPE_BASIC",
		"version":                  "OIDC_VERSION_1_0",
		"accessTokenType":          "OIDC_TOKEN_TYPE_JWT",
		"devMode":                  false,
		"accessTokenRoleAssertion": true,
		"idTokenRoleAssertion":     true,
		"idTokenUserinfoAssertion": true,
		"loginVersion": map[string]any{
			"loginV2": map[string]any{
				"baseUri": fmt.Sprintf("https://%s/ui/v2/login", zitadelHostname),
			},
		},
	}
}

func createOIDCApp(ctx context.Context, c *client, s *State, cfg Config) (appID, clientID, clientSecret string, err error) {
	var resp struct {
		AppID        string `json:"appId"`
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	zitadelHost := hostnameOf(cfg.BaseURL)
	if err := c.doJSON(ctx, http.MethodPost,
		"/management/v1/projects/"+s.ProjectID+"/apps/oidc",
		oidcAppBody(cfg.MenuHostname, zitadelHost),
		&resp, requestOpts{orgID: s.OrgID}); err != nil {
		return "", "", "", err
	}
	return resp.AppID, resp.ClientID, resp.ClientSecret, nil
}

func updateOIDCApp(ctx context.Context, c *client, s *State, cfg Config) error {
	zitadelHost := hostnameOf(cfg.BaseURL)
	// Update path: `/projects/{project_id}/apps/{app_id}/oidc_config`
	// (NOT `/apps/oidc/{app_id}` — that's the create-only path).
	return c.doJSON(ctx, http.MethodPut,
		"/management/v1/projects/"+s.ProjectID+"/apps/"+s.OIDCAppID+"/oidc_config",
		oidcAppBody(cfg.MenuHostname, zitadelHost),
		nil, requestOpts{orgID: s.OrgID})
}

func regenerateOIDCSecret(ctx context.Context, c *client, s *State) (string, error) {
	var resp struct {
		ClientSecret string `json:"clientSecret"`
	}
	// RegenerateOIDCClientSecret RPC path.
	if err := c.doJSON(ctx, http.MethodPost,
		"/management/v1/projects/"+s.ProjectID+"/apps/"+s.OIDCAppID+"/oidc_config/_generate_client_secret",
		map[string]any{}, &resp, requestOpts{orgID: s.OrgID}); err != nil {
		return "", err
	}
	if resp.ClientSecret == "" {
		return "", fmt.Errorf("regenerate secret returned empty value")
	}
	return resp.ClientSecret, nil
}

func findAppByName(ctx context.Context, c *client, orgID, projectID, name string) (appID, clientID string, err error) {
	body, status, derr := c.do(ctx, http.MethodPost,
		"/management/v1/projects/"+projectID+"/apps/_search",
		map[string]any{
			"queries": []any{
				map[string]any{"nameQuery": map[string]any{
					"name":   name,
					"method": "APP_NAME_QUERY_METHOD_EQUALS",
				}},
			},
		}, requestOpts{orgID: orgID})
	if derr != nil {
		return "", "", derr
	}
	if status >= 400 {
		return "", "", fmt.Errorf("search apps HTTP %d: %s", status, string(body))
	}
	var out struct {
		Result []struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			OIDCConfig struct {
				ClientID string `json:"clientId"`
			} `json:"oidcConfig"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", "", fmt.Errorf("decode search apps: %w", err)
	}
	for _, a := range out.Result {
		if a.Name == name {
			return a.ID, a.OIDCConfig.ClientID, nil
		}
	}
	return "", "", nil
}

// ── Store write-back ─────────────────────────────────────────────────────────

func writeOutputs(ctx context.Context, store secretStore, s *State) error {
	// PAT + signing keys are already written immediately on create. This
	// step writes the remaining outputs that are safe to defer (they're
	// derivable on next run if lost):
	//   - OIDC client_id (visible via search even after a wipe)
	//   - iedora project ID (visible via search)
	// And re-asserts client_secret in case the cold-create path wrote
	// stale state mid-run.
	upserts := []struct {
		key string
		val string
	}{
		{bwsKeyProjectID, s.ProjectID},
		{bwsKeyOIDCClientID, s.OIDCClientID},
	}
	if s.OIDCClientSecret != "" {
		upserts = append(upserts, struct {
			key string
			val string
		}{bwsKeyOIDCClientSecret, s.OIDCClientSecret})
	}
	for _, u := range upserts {
		if err := store.Write(ctx, u.key, u.val); err != nil {
			return fmt.Errorf("store write %s: %w", u.key, err)
		}
	}
	return nil
}

// ── Admin grants (subsumes the old zitadel-grant binary) ─────────────────────

func reconcileAdminGrants(ctx context.Context, c *client, s *State, emails []string) error {
	if len(emails) == 0 {
		return nil
	}
	var firstErr error
	for _, email := range emails {
		userID, err := findUserByEmail(ctx, c, s.OrgID, email)
		if err != nil {
			fmt.Fprintf(stderr, "  lookup  %s: %v\n", email, err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if userID == "" {
			fmt.Fprintf(stderr, "  skip    %s (no Zitadel user — sign in once via OIDC, then re-run)\n", email)
			continue
		}
		status, err := grant(ctx, c, s, userID)
		if err != nil {
			fmt.Fprintf(stderr, "  fail    %s (%s): %v\n", email, userID, err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		fmt.Fprintf(stderr, "  %-7s %s (%s)\n", status, email, userID)
	}
	return firstErr
}

func findUserByEmail(ctx context.Context, c *client, orgID, email string) (string, error) {
	body, status, err := c.do(ctx, http.MethodPost, "/v2/users",
		map[string]any{
			"queries": []any{
				map[string]any{"emailQuery": map[string]any{
					"emailAddress": email,
					"method":       "TEXT_QUERY_METHOD_EQUALS",
				}},
			},
		}, requestOpts{orgID: orgID})
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("search users HTTP %d: %s", status, string(body))
	}
	var out struct {
		Result []struct {
			UserID string `json:"userId"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode search users: %w", err)
	}
	if len(out.Result) == 0 {
		return "", nil
	}
	return out.Result[0].UserID, nil
}

func grant(ctx context.Context, c *client, s *State, userID string) (string, error) {
	err := c.doJSON(ctx, http.MethodPost,
		"/management/v1/users/"+userID+"/grants",
		map[string]any{
			"projectId": s.ProjectID,
			"roleKeys":  []string{iedoraAdminRoleKey},
		}, nil, requestOpts{orgID: s.OrgID})
	if err == nil {
		return "granted", nil
	}
	if errors.Is(err, ErrAlreadyExists) {
		return "already", nil
	}
	return "", err
}

// ── Small utils ──────────────────────────────────────────────────────────────

// hostnameOf returns the host[:port] portion of a baseURL like
// "https://auth.iedora.com" → "auth.iedora.com".
func hostnameOf(baseURL string) string {
	s := baseURL
	for _, p := range []string{"https://", "http://"} {
		if len(s) > len(p) && s[:len(p)] == p {
			s = s[len(p):]
			break
		}
	}
	if i := indexByte(s, '/'); i > 0 {
		s = s[:i]
	}
	return s
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
