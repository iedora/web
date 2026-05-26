# menu-translation

On-demand machine translation of a restaurant's menus, driven by a
"Refresh translations" button. Smart staleness — only rows whose source
text changed since the last sync are sent to the model, so an operator
who edits one item's name doesn't pay to re-translate the whole menu.

## Staleness model

Every translatable row (`item`, `category`) carries a nullable
`translations_synced_at` timestamp. A row is **stale** when:

```
translations_synced_at IS NULL  -- never synced
OR translations_synced_at < updated_at  -- source edited since last sync
```

`updated_at` is auto-bumped by Drizzle's `$onUpdate(() => new Date())`
hook on every write, so the operator gets the right behaviour just by
editing through the existing menu builder.

Refresh sets `translations_synced_at = now()` on every row it touched,
across all target languages, in the same transaction as the i18n writes.

## Translation targets

`restaurant.supportedLanguages` minus `restaurant.defaultLanguage`. If
the restaurant only supports its default language, the button is a no-op
and the action returns `{ ok: true, translated: 0 }`.

## Cross-slice imports

- `@iedora/observability` for tracer + meter (per-batch span around the
  Kimi call so we can see translation latency in OpenObserve).
- `@/features/auth` for `requireRestaurantBySlug` in the action.
- `@/features/menu-publishing` for `revalidateRestaurant(slug)` after a
  successful refresh — public menus pick up new languages immediately.

## Future

- **Per-field staleness** — today the whole row is stale if any source
  field changed. Splitting name/description tracking would save tokens
  on description-only edits, but the bookkeeping outweighs the win for
  now.
- **Cron-triggered sync** — a daily job that re-checks stale rows is
  trivial once the action is in place; not wired today.
- **Manual override flag** — operators who hand-edit a specific
  translation shouldn't have it overwritten on next sync. Tracked in
  GitHub issue #29.
- **Variant labels** — `item.variants[].label` isn't translated today.
  Same issue.
