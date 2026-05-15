# restaurant-identity slice

Mutations to the restaurant's branding, theme, languages, and the QR
viewer UI.

## Server actions (`@/features/restaurant-identity/actions`)

- `updateIdentity(slug, patch)` — name, description, i18n description map
- `updateLanguageSettings(slug, patch)` — default + supported languages
- `updateTheme(slug, theme)` — layout, font, primary/secondary colors

## UI (`@/features/restaurant-identity/ui/*`)

- `<ThemeEditor>` — live-preview settings editor (client)
- `<QrViewer>` — SVG/PNG download + print (client)

## Port + adapter

`IdentityWritePort` in `./ports.ts`. Production adapter
`./adapters/drizzle.ts`.

## Why this exists

Per-restaurant settings: branding, languages, theme. Asset uploads
(logo/banner files) flow through `@/features/upload`; this slice
mutates the *records* that reference those keys.
