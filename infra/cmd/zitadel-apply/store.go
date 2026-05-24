package main

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"sort"
	"sync"

	"github.com/eduvhc/iedora/infra/internal/bws"
)

// secretStore is the abstraction over where reconciled values are
// persisted. Two implementations:
//
//   - bwsStore: prod default. Reads + writes go through Bitwarden Secrets
//     Manager via the existing `infra/internal/bws` package.
//   - memoryStore: dev / `--no-bws` mode. Reads + writes live in an
//     in-process map. Optionally serialized to a JSON file at the end of
//     the run via Flush so the dev orchestrator can compose env files
//     from the result.
//
// The interface lets reconcile.go stay agnostic to where values land —
// the (bws-has, zitadel-has) recovery matrix works the same way for
// both stores.
type secretStore interface {
	Read(ctx context.Context, key string) (string, bool, error)
	Write(ctx context.Context, key, value string) error
	Delete(ctx context.Context, key string) error
	// Flush is called after reconcile completes. bwsStore is a no-op
	// (writes already persisted live); memoryStore writes the JSON file.
	Flush() error
}

// bwsStore — prod default. Lazily resolves projectID once, reuses across
// reads to avoid hammering `bws project list`. Writes invalidate the
// list cache so subsequent Reads see the new value.
type bwsStore struct {
	projectID string
	mu        sync.Mutex
	cache     []bws.Secret
}

func newBWSStore(projectID string) *bwsStore {
	return &bwsStore{projectID: projectID}
}

func (s *bwsStore) list(ctx context.Context) ([]bws.Secret, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache != nil {
		return s.cache, nil
	}
	out, err := bws.ListSecrets(ctx, s.projectID)
	if err != nil {
		return nil, err
	}
	s.cache = out
	return out, nil
}

func (s *bwsStore) invalidate() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache = nil
}

func (s *bwsStore) Read(ctx context.Context, key string) (string, bool, error) {
	secrets, err := s.list(ctx)
	if err != nil {
		return "", false, fmt.Errorf("bws list: %w", err)
	}
	_, val, found := bws.Find(secrets, key)
	return val, found, nil
}

func (s *bwsStore) Write(ctx context.Context, key, value string) error {
	if err := bws.Upsert(ctx, s.projectID, key, value); err != nil {
		return err
	}
	s.invalidate()
	return nil
}

func (s *bwsStore) Delete(ctx context.Context, key string) error {
	if err := bws.Delete(ctx, s.projectID, key); err != nil {
		return err
	}
	s.invalidate()
	return nil
}

func (s *bwsStore) Flush() error { return nil }

// memoryStore — dev / `--no-bws` mode. Reads see only what's been
// written this session (no cross-run persistence) PLUS any values
// pre-seeded via NewMemoryStore (e.g. dev orchestrator reads an
// existing outputs.json from a prior `task dev` to keep values stable
// across restarts).
type memoryStore struct {
	mu         sync.Mutex
	values     map[string]string
	outputPath string // optional — Flush writes JSON here when set
}

// newMemoryStore creates a store seeded with `seed`. `outputPath` is
// the file Flush serializes to; pass "" to skip serialization.
func newMemoryStore(seed map[string]string, outputPath string) *memoryStore {
	v := make(map[string]string, len(seed))
	maps.Copy(v, seed)
	return &memoryStore{values: v, outputPath: outputPath}
}

func (s *memoryStore) Read(_ context.Context, key string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	val, found := s.values[key]
	return val, found, nil
}

func (s *memoryStore) Write(_ context.Context, key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[key] = value
	return nil
}

func (s *memoryStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, key)
	return nil
}

// Flush writes the in-memory state to JSON. Keys sorted alphabetically
// so re-running on no-change produces an identical file (useful for
// git-diff-style verification in tests + dev workflows).
func (s *memoryStore) Flush() error {
	if s.outputPath == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.values))
	for k := range s.values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	ordered := make(map[string]string, len(s.values))
	for _, k := range keys {
		ordered[k] = s.values[k]
	}
	body, err := json.MarshalIndent(ordered, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	// 0600: the file holds OIDC client_secret + PAT tokens. Even on a
	// throwaway dev box, world-readable would be a footgun.
	return os.WriteFile(s.outputPath, body, 0o600)
}

// loadSeedJSON reads a previous Flush output back into a seed map. Used
// by the dev orchestrator to pre-populate the memoryStore so a re-run
// keeps existing PAT + signing keys (avoids unnecessary delete-recreate
// of Zitadel resources on every `task dev`).
func loadSeedJSON(path string) (map[string]string, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out map[string]string
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("decode seed %s: %w", path, err)
	}
	return out, nil
}
