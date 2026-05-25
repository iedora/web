// iedora-backup — replaces infra/backup/{run,backup,restore}.sh with a
// single Go binary. Lives inside the backup container alongside
// pg_dump/pg_dumpall/pg_restore/psql/gpg (external binaries the Go
// process still shells out to). aws-cli is gone — uses the pure-Go
// SigV4 S3 client at infra/internal/r2.
//
// Subcommands:
//
//	iedora-backup            (or `run`) — daemon loop: every SCHEDULE seconds, take a backup
//	iedora-backup backup     — one-shot backup
//	iedora-backup restore [KEY] — restore latest, or specific key
//
// Env (same shape the bash scripts read):
//
//	POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE
//	S3_ENDPOINT, S3_BUCKET, S3_PREFIX, S3_REGION
//	S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
//	PASSPHRASE
//	SCHEDULE          @daily / @hourly / @weekly / <int seconds>
//	BACKUP_KEEP_DAYS  optional; prune dumps older than N days after upload
//
// All operator-facing logging goes to stderr — same as the bash
// scripts. The container's CMD is `iedora-backup` (no args) → daemon mode.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	args := os.Args[1:]
	cmd := "run"
	if len(args) > 0 {
		cmd = args[0]
		args = args[1:]
	}

	var err error
	switch cmd {
	case "run":
		err = runDaemon(ctx)
	case "backup":
		err = runBackup(ctx)
	case "restore":
		var key string
		if len(args) > 0 {
			key = args[0]
		}
		err = runRestore(ctx, key)
	case "-h", "--help", "help":
		fmt.Println(`iedora-backup — encrypted Postgres backup to S3-compatible storage.

Subcommands:
  iedora-backup              (or `+"`run`"+`) — daemon loop, runs `+"`backup`"+` every SCHEDULE
  iedora-backup backup       one-shot backup
  iedora-backup restore [KEY]  restore latest dump, or a specific S3 key

Env: POSTGRES_*, S3_*, PASSPHRASE, SCHEDULE, BACKUP_KEEP_DAYS.`)
		return
	default:
		fmt.Fprintf(os.Stderr, "iedora-backup: unknown subcommand %q\n", cmd)
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "iedora-backup %s: %v\n", cmd, err)
		os.Exit(1)
	}
}
