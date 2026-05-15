# i18n slice

Per-language registry + format helpers + the LocalizedFields editor UI.

## Public API (`@/features/i18n`)

- `LANGUAGES`, `LANGUAGE_CODES`, `LANGUAGE_META`, `getLanguage`, `isLanguageCode` — language registry
- `LocalizedText` (type), `Language`, `LanguageCode`, `LanguageMeta` — i18n value shapes
- `localized`, `localizedNullable`, `pickLanguage` — format helpers

## Server-only (`@/features/i18n/server`)

- `localizedSchema`, `pruneLocalized` — Zod schema + helper for translatable text records

## UI (`@/features/i18n/ui/localized-fields`)

- `<LocalizedFields />` — tabbed name+description editor used by item /
  category / identity dialogs.

## Why this exists

AGENTS.md hard rule #10: each supported language is a self-contained
module under `languages/<code>/`. `registry.ts` is the only place that
knows the full set; `LANGUAGE_CODES`, `LANGUAGE_META`, and `getLanguage`
are derived. Add a new language by adding a folder + one entry — see
the `add-language` skill.

No port/adapter inside the slice: this is pure data + UI, no I/O.
