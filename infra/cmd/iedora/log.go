package main

import (
	"context"
	"io"
	"os"
	"time"
)

// stderr is the single sink for every status line. Using an io.Writer
// indirection lets tests capture output.
var stderr io.Writer = os.Stderr

// sleep is context-aware. If the context is cancelled, returns early.
// Callers don't need to check the return — the next iteration of their
// poll loop will see ctx.Err() too.
func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-time.After(d):
	case <-ctx.Done():
	}
}
