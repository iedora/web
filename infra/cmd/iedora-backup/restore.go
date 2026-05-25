package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/eduvhc/iedora/infra/internal/r2"
)

// config bundles every env-derived setting both backup and restore
// share. loadConfig is responsible for env validation; the
// subcommands take the parsed struct.
type config struct {
	PGHost      string
	PGUser      string
	PGPassword  string
	PGDatabase  string // empty = cluster-wide pg_dumpall
	S3Endpoint  string
	S3Bucket    string
	S3Prefix    string
	S3AccessKey string
	S3Secret    string
	Passphrase  string
	KeepDays    int // 0 = no pruning
}

func loadConfig() (config, error) {
	var c config
	for _, p := range []struct {
		key string
		dst *string
	}{
		{"POSTGRES_HOST", &c.PGHost},
		{"POSTGRES_USER", &c.PGUser},
		{"POSTGRES_PASSWORD", &c.PGPassword},
		{"S3_ENDPOINT", &c.S3Endpoint},
		{"S3_BUCKET", &c.S3Bucket},
		{"S3_ACCESS_KEY_ID", &c.S3AccessKey},
		{"S3_SECRET_ACCESS_KEY", &c.S3Secret},
		{"PASSPHRASE", &c.Passphrase},
	} {
		v, err := mustEnv(p.key)
		if err != nil {
			return c, err
		}
		*p.dst = v
	}
	c.PGDatabase = os.Getenv("POSTGRES_DATABASE")
	c.S3Prefix = os.Getenv("S3_PREFIX")

	if v := os.Getenv("BACKUP_KEEP_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return c, fmt.Errorf("BACKUP_KEEP_DAYS=%q: want a non-negative integer", v)
		}
		c.KeepDays = n
	}
	return c, nil
}

// runRestore downloads + decrypts a dump and pipes it into the right
// loader. Key suffix selects the tool:
//
//	*.sql.gpg  → psql cluster-wide (pg_dumpall output)
//	*.dump.gpg → pg_restore into POSTGRES_DATABASE (must be set)
//
// If keyArg is "", picks the latest dump under the configured prefix
// (sorted by LastModified — see r2.ListObjects).
func runRestore(ctx context.Context, keyArg string) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	client, err := r2.NewFromEndpoint(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3Secret)
	if err != nil {
		return err
	}

	key := keyArg
	if key == "" {
		key, err = latestKey(ctx, client, cfg)
		if err != nil {
			return err
		}
	}
	fmt.Fprintf(os.Stderr, "[restore] using s3://%s/%s\n", cfg.S3Bucket, key)

	encrypted, err := client.GetObject(ctx, cfg.S3Bucket, key)
	if err != nil {
		return err
	}

	plaintext, err := decrypt(ctx, encrypted, cfg.Passphrase)
	if err != nil {
		return fmt.Errorf("gpg decrypt: %w", err)
	}

	switch {
	case strings.HasSuffix(key, ".sql.gpg"):
		fmt.Fprintf(os.Stderr, "[restore] psql cluster-wide → %s\n", cfg.PGHost)
		return execLoader(ctx, cfg, plaintext, "psql",
			"-h", cfg.PGHost, "-U", cfg.PGUser, "-d", "postgres")
	default:
		// .dump.gpg or unknown suffix — pg_restore needs a target DB.
		if cfg.PGDatabase == "" {
			return fmt.Errorf("POSTGRES_DATABASE must be set to restore a single-DB .dump.gpg")
		}
		fmt.Fprintf(os.Stderr, "[restore] pg_restore into %s@%s\n", cfg.PGDatabase, cfg.PGHost)
		return execLoader(ctx, cfg, plaintext, "pg_restore",
			"--clean", "--if-exists", "--no-owner", "--no-privileges",
			"-h", cfg.PGHost, "-U", cfg.PGUser, "-d", cfg.PGDatabase)
	}
}

func latestKey(ctx context.Context, client *r2.Client, cfg config) (string, error) {
	prefix := cfg.S3Prefix
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	objects, err := client.ListObjects(ctx, cfg.S3Bucket, prefix)
	if err != nil {
		return "", err
	}
	if len(objects) == 0 {
		return "", fmt.Errorf("no backups found in s3://%s/%s", cfg.S3Bucket, prefix)
	}
	// ListObjects returns ascending; latest = last.
	return objects[len(objects)-1].Key, nil
}

// decrypt runs `gpg --decrypt` over the ciphertext, passing the
// passphrase via fd 3 (same channel backup uses for encryption).
func decrypt(ctx context.Context, ciphertext []byte, passphrase string) ([]byte, error) {
	passR, passW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer passR.Close()

	gpg := exec.CommandContext(ctx, "gpg",
		"--batch", "--yes",
		"--passphrase-fd", "3",
		"--decrypt")
	gpg.Stdin = strings.NewReader(string(ciphertext))
	gpg.Stderr = os.Stderr
	gpg.ExtraFiles = []*os.File{passR}

	out, err := gpg.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := gpg.Start(); err != nil {
		return nil, err
	}
	if _, err := passW.WriteString(passphrase + "\n"); err != nil {
		return nil, err
	}
	_ = passW.Close()

	plaintext, err := readAll(out)
	if err != nil {
		return nil, err
	}
	if err := gpg.Wait(); err != nil {
		return nil, err
	}
	return plaintext, nil
}

// execLoader pipes `payload` into the loader command's stdin.
func execLoader(ctx context.Context, cfg config, payload []byte, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+cfg.PGPassword)
	cmd.Stdin = strings.NewReader(string(payload))
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	fmt.Fprintln(os.Stderr, "[restore] done")
	return nil
}

// readAll is io.ReadAll wrapped in a name that backup.go also uses.
// Kept in restore.go for proximity to its primary consumer.
func readAll(r io.Reader) ([]byte, error) {
	return io.ReadAll(r)
}
