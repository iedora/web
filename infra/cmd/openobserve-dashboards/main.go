// openobserve-dashboards — Stage 3 configurator that pushes the
// version-controlled OO dashboards (`infra/openobserve/dashboards/*.json`)
// to the running OpenObserve instance on the Hetzner box.
//
// Why this lives in Go (replacing the prior bash apply-dashboards):
//
//   - OpenObserve in prod has no public DNS. The container only binds
//     to 127.0.0.1:5080 on the box (defence-in-depth on top of the
//     Hetzner firewall that already blocks port 5080 publicly). The
//     bash script's `curl https://obs.iedora.com` path doesn't reach.
//
//   - Symmetry with the other Stage 3 configurators (`zitadel-apply`,
//     `menu-db-migrations`). All three are Go binaries with their own
//     health-gate + credential fetch + idempotent reconcile.
//
//   - Dashboards travel with the binary (`//go:embed`), so there's no
//     scp dance, no version skew between repo and box.
//
// Network path:
//
//   operator's-laptop                  box:22 (SSH)             box-localhost:5080 (OO)
//   ──────────────────  ssh -L 15080:─────────────  TCP fwd  ────────────────────
//   http://localhost:15080  ───────────►              ─────►   http(s) OO API
//
// The Hetzner firewall doesn't open 5080 publicly; the OO container's
// `expose_host_ip = 127.0.0.1` further constrains it. SSH `-L` punches
// through both — anything reachable from `box:localhost` is reachable
// at our local forwarded port.
//
// Inputs (env, set by `bin/with-secrets --stage app` from BWS):
//
//	IAC_BOOTSTRAP_HOST_IP                                  Hetzner box IPv4 (universal scope)
//	IAC_BOOTSTRAP_SSH_PRIVATE_KEY                          loaded into ssh-agent before exec OR
//	                                               written to ~/.ssh/id_ed25519 — same
//	                                               as every other SSH-using binary
//	IAC_BOOTSTRAP_OPENOBSERVE_ROOT_USER_EMAIL              HTTP Basic user
//	IAC_OPENOBSERVE_ROOT_USER_PASSWORD   HTTP Basic password (Tofu-minted)
//
// Optional env:
//
//	OO_ORG          OpenObserve org name. Default "default".
//	OO_FOLDER       Dashboard folder. Default "default".
//	OO_LOCAL_PORT   Local forwarded port. Default 15080.
package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// dashboardsFS embeds every JSON in the repo's
// `infra/openobserve/dashboards/` directory at compile time. Editing a
// dashboard = edit the JSON + rebuild (or `go run`); next `task app:apply`
// picks it up. No external state, no version skew.
//
//go:embed dashboards/*.json
var dashboardsFS embed.FS

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "openobserve-dashboards: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	host := os.Getenv("IAC_BOOTSTRAP_HOST_IP")
	if host == "" {
		return fmt.Errorf("IAC_BOOTSTRAP_HOST_IP missing — `task infra:up` should have written it to BWS")
	}
	email := mustEnv("IAC_BOOTSTRAP_OPENOBSERVE_ROOT_USER_EMAIL")
	password := mustEnv("IAC_OPENOBSERVE_ROOT_USER_PASSWORD")

	org := envOr("OO_ORG", "default")
	folder := envOr("OO_FOLDER", "default")
	localPort, err := strconv.Atoi(envOr("OO_LOCAL_PORT", "15080"))
	if err != nil {
		return fmt.Errorf("OO_LOCAL_PORT: %w", err)
	}

	fmt.Fprintf(os.Stderr, "→ openobserve-dashboards: opening SSH tunnel root@%s:22 → localhost:%d → box-localhost:5080\n", host, localPort)
	tun, err := openSSHTunnel(ctx, host, localPort)
	if err != nil {
		return fmt.Errorf("open ssh tunnel: %w", err)
	}
	defer tun.Close()

	base := fmt.Sprintf("http://127.0.0.1:%d", localPort)
	c := &client{
		base:    base,
		org:     org,
		folder:  folder,
		auth:    "Basic " + base64.StdEncoding.EncodeToString([]byte(email+":"+password)),
		http:    &http.Client{Timeout: 30 * time.Second},
	}

	// Health-gate before reconcile. tunnel is up immediately but OO
	// itself might be coming back from a restart.
	if err := c.waitReady(ctx, 30*time.Second); err != nil {
		return fmt.Errorf("openobserve readiness: %w (check `ssh root@%s docker logs infra-openobserve`)", err, host)
	}

	if err := reconcile(ctx, c); err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "✓ openobserve-dashboards: in sync")
	return nil
}

// ── Reconcile ────────────────────────────────────────────────────────────────

// reconcile lists the dashboards currently in the target folder, then
// for each embedded JSON: match by title → PUT-with-hash on hit, POST
// on miss. Idempotent.
func reconcile(ctx context.Context, c *client) error {
	listed, err := c.listDashboards(ctx)
	if err != nil {
		return fmt.Errorf("list dashboards: %w", err)
	}
	byTitle := map[string]string{} // title -> id
	for _, d := range listed {
		byTitle[d.title] = d.id
	}

	entries, err := dashboardsFS.ReadDir("dashboards")
	if err != nil {
		return fmt.Errorf("read embedded dashboards: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		body, err := fs.ReadFile(dashboardsFS, "dashboards/"+e.Name())
		if err != nil {
			return fmt.Errorf("read %s: %w", e.Name(), err)
		}
		title, err := jsonString(body, "title")
		if err != nil {
			return fmt.Errorf("extract title from %s: %w", e.Name(), err)
		}
		fmt.Fprintf(os.Stderr, "  • %s — title=%q\n", e.Name(), title)

		if id, ok := byTitle[title]; ok {
			// Update path. Optimistic-concurrency hash on PUT.
			if err := c.updateDashboard(ctx, id, body); err != nil {
				return fmt.Errorf("update %s (%s): %w", e.Name(), id, err)
			}
			fmt.Fprintf(os.Stderr, "    ✓ updated (%s)\n", id)
		} else {
			id, err := c.createDashboard(ctx, body)
			if err != nil {
				return fmt.Errorf("create %s: %w", e.Name(), err)
			}
			fmt.Fprintf(os.Stderr, "    ✓ created (%s)\n", id)
		}
	}
	return nil
}

// ── HTTP client over the tunnel ──────────────────────────────────────────────

type client struct {
	base   string
	org    string
	folder string
	auth   string // pre-built "Basic <b64>" Authorization header
	http   *http.Client
}

// waitReady probes /healthz until 200 or timeout. OO returns 200 only
// after its boot is complete (DB migrations, S3 connect, etc.).
func (c *client) waitReady(ctx context.Context, budget time.Duration) error {
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/healthz", nil)
		resp, err := c.http.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
		}
		select {
		case <-time.After(500 * time.Millisecond):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return fmt.Errorf("not ready after %s", budget)
}

// listed is a flattened {id,title} pair extracted from OpenObserve's
// list response. OO nests dashboards under different keys across
// versions (top-level array, `.list[]`, `.dashboards[]`) AND the
// version slot (`v5` / `v6` / `v7` / `v8`) where `id` + `title` live
// migrates silently after a PUT. We probe everywhere — same heuristic
// as the prior bash + jq.
type listed struct {
	id    string
	title string
}

func (c *client) listDashboards(ctx context.Context) ([]listed, error) {
	u := c.base + "/api/" + c.org + "/dashboards?folder=" + url.QueryEscape(c.folder)
	body, err := c.do(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// Decode into a flexible shape: try a few container keys.
	var top any
	if err := json.Unmarshal(body, &top); err != nil {
		return nil, fmt.Errorf("decode list: %w", err)
	}
	items := extractDashboardArray(top)
	out := make([]listed, 0, len(items))
	for _, item := range items {
		m, _ := item.(map[string]any)
		out = append(out, listed{
			id:    extractIDFromVersionSlots(m),
			title: extractTitleFromVersionSlots(m),
		})
	}
	return out, nil
}

func (c *client) updateDashboard(ctx context.Context, id string, payload []byte) error {
	// Pull current GET to extract the hash for optimistic concurrency.
	getURL := c.base + "/api/" + c.org + "/dashboards/" + id + "?folder=" + url.QueryEscape(c.folder)
	current, err := c.do(ctx, http.MethodGet, getURL, nil)
	if err != nil {
		return fmt.Errorf("get current: %w", err)
	}
	var currentMap map[string]any
	_ = json.Unmarshal(current, &currentMap)
	hash := extractHashFromVersionSlots(currentMap)

	putURL := getURL
	if hash != "" {
		putURL += "&hash=" + url.QueryEscape(hash)
	} else {
		fmt.Fprintf(os.Stderr, "    ⚠ no hash on existing dashboard %s — falling back to PUT without hash\n", id)
	}

	// Inject the existing id so the payload matches what OO expects.
	patched, err := injectDashboardID(payload, id)
	if err != nil {
		return err
	}
	if _, err := c.do(ctx, http.MethodPut, putURL, patched); err != nil {
		return err
	}
	return nil
}

func (c *client) createDashboard(ctx context.Context, payload []byte) (string, error) {
	postURL := c.base + "/api/" + c.org + "/dashboards?folder=" + url.QueryEscape(c.folder)
	body, err := c.do(ctx, http.MethodPost, postURL, payload)
	if err != nil {
		return "", err
	}
	var m map[string]any
	_ = json.Unmarshal(body, &m)
	if id := extractIDFromVersionSlots(m); id != "" {
		return id, nil
	}
	return "?", nil
}

func (c *client) do(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", c.auth)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return respBody, fmt.Errorf("HTTP %d %s %s: %s", resp.StatusCode, method, url, strings.TrimSpace(string(respBody)))
	}
	return respBody, nil
}

// ── Shape-matching helpers (port of the bash + jq tricks) ────────────────────

// extractDashboardArray walks the list response and returns whatever
// array shape OpenObserve responded with. Three shapes seen in the
// wild: top-level array, `.list[]`, `.dashboards[]`.
func extractDashboardArray(top any) []any {
	if arr, ok := top.([]any); ok {
		return arr
	}
	m, ok := top.(map[string]any)
	if !ok {
		return nil
	}
	for _, k := range []string{"list", "dashboards"} {
		if arr, ok := m[k].([]any); ok {
			return arr
		}
	}
	return nil
}

// extractIDFromVersionSlots / extractTitleFromVersionSlots — look at
// top-level AND every v1..v8 nested object. OO silently migrates a
// dashboard's payload across version slots on PUT, so matching only
// `.v5.dashboardId` misses the migrated copies. Try them all.
func extractIDFromVersionSlots(m map[string]any) string {
	if m == nil {
		return ""
	}
	for _, k := range []string{"dashboard_id", "dashboardId", "id"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	for _, vk := range []string{"v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1"} {
		sub, ok := m[vk].(map[string]any)
		if !ok {
			continue
		}
		for _, k := range []string{"dashboardId", "dashboard_id", "id"} {
			if v, ok := sub[k].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

func extractTitleFromVersionSlots(m map[string]any) string {
	if m == nil {
		return ""
	}
	if v, ok := m["title"].(string); ok && v != "" {
		return v
	}
	for _, vk := range []string{"v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1"} {
		if sub, ok := m[vk].(map[string]any); ok {
			if v, ok := sub["title"].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

func extractHashFromVersionSlots(m map[string]any) string {
	if m == nil {
		return ""
	}
	if v, ok := m["hash"].(string); ok && v != "" {
		return v
	}
	for _, vk := range []string{"v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1"} {
		if sub, ok := m[vk].(map[string]any); ok {
			if v, ok := sub["hash"].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

// injectDashboardID sets `.dashboardId = <id>` on the JSON payload before
// PUT. Mirrors the prior `jq --arg id "$existing_id" '.dashboardId = $id'`.
func injectDashboardID(body []byte, id string) ([]byte, error) {
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	m["dashboardId"] = id
	return json.Marshal(m)
}

// jsonString extracts a top-level string field from a JSON body. Used
// to read the dashboard `title` from the embedded file before sending.
func jsonString(body []byte, key string) (string, error) {
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return "", err
	}
	if v, ok := m[key].(string); ok {
		return v, nil
	}
	return "", fmt.Errorf("field %q missing or not a string", key)
}

// ── SSH tunnel ───────────────────────────────────────────────────────────────

// tunnel is the lifecycle handle for `ssh -L 15080:localhost:5080 -N -f`.
// Close() kills the SSH process (via the pidfile that ControlMaster
// would manage — we use a simpler approach: keep the cmd in-process
// and SIGTERM on Close).
type tunnel struct {
	cmd *exec.Cmd
}

func (t *tunnel) Close() error {
	if t == nil || t.cmd == nil || t.cmd.Process == nil {
		return nil
	}
	// Terminate the SSH child. `-N` makes it idle (no remote command),
	// so SIGTERM cleanly closes the connection.
	_ = t.cmd.Process.Signal(syscall.SIGTERM)
	_, _ = t.cmd.Process.Wait()
	return nil
}

// openSSHTunnel runs `ssh -L <localPort>:localhost:5080 -N root@host`
// in the background, polls the local port until it accepts TCP, then
// returns the handle. The caller defers Close() to tear down.
//
// `-N` = no remote command (just the forward). `-o ServerAliveInterval`
// keeps the tunnel alive across short network blips. We deliberately
// do NOT use `-f` (background-then-exit) because that orphans the SSH
// process; instead we keep the *exec.Cmd in-process and signal it
// directly on Close.
func openSSHTunnel(ctx context.Context, host string, localPort int) (*tunnel, error) {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"-o", "ServerAliveInterval=15",
		"-o", "ExitOnForwardFailure=yes",
		"-N",
		"-L", fmt.Sprintf("%d:localhost:5080", localPort),
		"root@"+host,
	)
	// Inherit stderr for ssh's own diagnostics; stdout shouldn't have anything.
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ssh start: %w", err)
	}

	// Poll the local port until something accepts.
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", localPort), 500*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return &tunnel{cmd: cmd}, nil
		}
		// Has SSH crashed already? `ProcessState` is non-nil once Wait
		// returns; we haven't called Wait, so check Process.Pid.
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			return nil, fmt.Errorf("ssh exited prematurely (rc=%d)", cmd.ProcessState.ExitCode())
		}
		select {
		case <-time.After(200 * time.Millisecond):
		case <-ctx.Done():
			_ = cmd.Process.Kill()
			return nil, ctx.Err()
		}
	}
	_ = cmd.Process.Kill()
	return nil, fmt.Errorf("tunnel never came up on 127.0.0.1:%d", localPort)
}

// ── env helpers ──────────────────────────────────────────────────────────────

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "env %s is required\n", key)
		os.Exit(1)
	}
	return v
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
