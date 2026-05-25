package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/eduvhc/iedora/infra/internal/r2"
)

// runBackup is the one-shot path: pg_dump → gpg → upload + optional
// retention prune. Behaviour matches the prior backup.sh exactly:
//
//	POSTGRES_DATABASE empty → cluster-wide `pg_dumpall --clean --if-exists`
//	                          → plain SQL → KEY=<prefix>/all-<ts>.sql.gpg
//	POSTGRES_DATABASE set   → `pg_dump --format=custom --compress=9`
//	                          → custom format → KEY=<prefix>/<db>-<ts>.dump.gpg
//
// On success, if BACKUP_KEEP_DAYS is set, prunes objects under the
// same prefix older than the cutoff.
func runBackup(ctx context.Context) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	timestamp := time.Now().UTC().Format("2006-01-02-150405")
	label := "all"
	suffix := ".sql.gpg"
	dumpCmd := exec.CommandContext(ctx, "pg_dumpall", "--clean", "--if-exists",
		"-h", cfg.PGHost, "-U", cfg.PGUser)
	if cfg.PGDatabase != "" {
		label = cfg.PGDatabase
		suffix = ".dump.gpg"
		dumpCmd = exec.CommandContext(ctx, "pg_dump", "--format=custom", "--compress=9",
			"-h", cfg.PGHost, "-U", cfg.PGUser, "-d", cfg.PGDatabase)
	}
	dumpCmd.Env = append(os.Environ(), "PGPASSWORD="+cfg.PGPassword)
	dumpCmd.Stderr = os.Stderr

	key := joinPrefix(cfg.S3Prefix, label+"-"+timestamp+suffix)

	if cfg.PGDatabase != "" {
		fmt.Fprintf(os.Stderr, "[backup] %s pg_dump %s@%s\n",
			time.Now().UTC().Format(time.RFC3339), cfg.PGDatabase, cfg.PGHost)
	} else {
		fmt.Fprintf(os.Stderr, "[backup] %s pg_dumpall @%s\n",
			time.Now().UTC().Format(time.RFC3339), cfg.PGHost)
	}

	// Pipe: pg_dump → gpg → in-memory buffer (so SigV4 can hash the
	// payload). Backup dumps are bounded (cents of MB to a few GB)
	// and fit in RAM on the box; if that ever changes, switch to
	// multipart upload + streaming hash.
	encrypted, err := dumpAndEncrypt(ctx, dumpCmd, cfg.Passphrase)
	if err != nil {
		return fmt.Errorf("dump+encrypt: %w", err)
	}

	fmt.Fprintf(os.Stderr, "[backup] encrypted size: %d bytes; uploading s3://%s/%s\n",
		len(encrypted), cfg.S3Bucket, key)

	client, err := r2.NewFromEndpoint(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3Secret)
	if err != nil {
		return err
	}
	if err := client.PutObject(ctx, cfg.S3Bucket, key, encrypted, "application/octet-stream"); err != nil {
		return err
	}

	if cfg.KeepDays > 0 {
		if err := prune(ctx, client, cfg); err != nil {
			// Pruning is best-effort — we already wrote a fresh dump,
			// so retention drift is recoverable next cycle.
			fmt.Fprintf(os.Stderr, "[backup] prune failed (continuing): %v\n", err)
		}
	}

	fmt.Fprintln(os.Stderr, "[backup] done")
	return nil
}

// dumpAndEncrypt wires `pg_dump | gpg --symmetric` into a single
// buffered byte slice. gpg reads the passphrase from a file
// descriptor (--passphrase-fd 3) so it never appears in process
// arguments or shell history — same behaviour the bash version had.
func dumpAndEncrypt(ctx context.Context, dump *exec.Cmd, passphrase string) ([]byte, error) {
	dumpOut, err := dump.StdoutPipe()
	if err != nil {
		return nil, err
	}

	// gpg --passphrase-fd 3 reads from fd 3. Create a pipe; gpg
	// inherits the read end via ExtraFiles[0] = fd 3.
	passR, passW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer passR.Close()

	gpg := exec.CommandContext(ctx, "gpg",
		"--batch", "--yes",
		"--passphrase-fd", "3",
		"--symmetric", "--cipher-algo", "AES256")
	gpg.Stdin = dumpOut
	gpg.Stderr = os.Stderr
	gpg.ExtraFiles = []*os.File{passR}

	gpgOutPipe, err := gpg.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := dump.Start(); err != nil {
		return nil, fmt.Errorf("start dump: %w", err)
	}
	if err := gpg.Start(); err != nil {
		_ = dump.Process.Kill()
		return nil, fmt.Errorf("start gpg: %w", err)
	}

	// Feed the passphrase + close so gpg sees EOF on fd 3.
	if _, err := passW.WriteString(passphrase + "\n"); err != nil {
		return nil, err
	}
	_ = passW.Close()

	// Drain gpg stdout fully.
	encrypted, err := readAll(gpgOutPipe)
	if err != nil {
		return nil, fmt.Errorf("read gpg: %w", err)
	}

	if err := dump.Wait(); err != nil {
		return nil, fmt.Errorf("pg_dump: %w", err)
	}
	if err := gpg.Wait(); err != nil {
		return nil, fmt.Errorf("gpg: %w", err)
	}
	return encrypted, nil
}

// prune removes objects under cfg.S3Prefix older than KeepDays. The
// list call returns time-sorted results, so we walk forward and stop
// at the first newer-than-cutoff entry.
func prune(ctx context.Context, client *r2.Client, cfg config) error {
	cutoff := time.Now().UTC().Add(-time.Duration(cfg.KeepDays) * 24 * time.Hour)
	fmt.Fprintf(os.Stderr, "[backup] pruning > %dd (cutoff %s)\n",
		cfg.KeepDays, cutoff.Format(time.RFC3339))

	prefix := cfg.S3Prefix
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	objects, err := client.ListObjects(ctx, cfg.S3Bucket, prefix)
	if err != nil {
		return err
	}
	for _, obj := range objects {
		if !obj.LastModified.Before(cutoff) {
			break // sorted ascending — first newer entry ends the prune
		}
		fmt.Fprintf(os.Stderr, "[backup] prune %s\n", obj.Key)
		if err := client.DeleteObject(ctx, cfg.S3Bucket, obj.Key); err != nil {
			return fmt.Errorf("delete %s: %w", obj.Key, err)
		}
	}
	return nil
}

func joinPrefix(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return strings.TrimSuffix(prefix, "/") + "/" + key
}
