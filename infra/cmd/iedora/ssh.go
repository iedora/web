package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
)

// rotateKnownHosts deals with the most common foot-gun in IP-recycled
// destroy/deploy cycles: the operator's ~/.ssh/known_hosts still pins
// the prior server's host key under this IP. Any SSH that goes through
// the system ssh client (kreuzwerker/docker provider, our own
// `docker logs` / `psql` shortcuts) will fail with "REMOTE HOST
// IDENTIFICATION HAS CHANGED" — and on a fresh deploy the symptom is
// indistinguishable from a real MITM, so the docker provider just
// errors out.
//
// We rotate by `ssh-keygen -R` (idempotent — no entry => no-op) and
// `ssh-keyscan -H` to capture the FRESH key into ~/.ssh/known_hosts.
// All silent on errors: a missing tool is acceptable in CI (CI has its
// own preflight ssh-keyscan step) and the destroy path can run before
// ~/.ssh exists.
func rotateKnownHosts(ctx context.Context, ips ...string) {
	khPath := knownHostsPath()
	_ = os.MkdirAll(filepath.Dir(khPath), 0o700)

	for _, ip := range ips {
		if ip == "" {
			continue
		}
		// -R is idempotent and tolerates a missing file.
		_ = exec.CommandContext(ctx, "ssh-keygen", "-R", ip, "-f", khPath).Run()
	}
	for _, ip := range ips {
		if ip == "" {
			continue
		}
		cmd := exec.CommandContext(ctx, "ssh-keyscan", "-H", "-T", "5", ip)
		// Append directly to the known_hosts file.
		f, err := os.OpenFile(khPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			continue
		}
		cmd.Stdout = f
		_ = cmd.Run()
		_ = f.Close()
	}
}

func knownHostsPath() string {
	if h, err := os.UserHomeDir(); err == nil {
		return filepath.Join(h, ".ssh", "known_hosts")
	}
	if u, err := user.Current(); err == nil {
		return filepath.Join(u.HomeDir, ".ssh", "known_hosts")
	}
	return "/dev/null" // fall through to a noop — better than panicking
}

// sshExec runs an SSH command on root@host. stdout/stderr stream to the
// operator's terminal. Used for the zitadel-fetch-sa-key and wipe-* paths.
func sshExec(ctx context.Context, host string, remoteCmd string) error {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"root@"+host, remoteCmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// sshCapture runs an SSH command and returns its stdout. stderr is
// forwarded so the user sees what went wrong.
func sshCapture(ctx context.Context, host string, remoteCmd string) (string, error) {
	cmd := exec.CommandContext(ctx, "ssh",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "ConnectTimeout=10",
		"root@"+host, remoteCmd)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("ssh root@%s %q: %w", host, remoteCmd, err)
	}
	return string(out), nil
}
