# i18n/testing — slice E2E surface

i18n has no DB to seed; the registry is compile-time. Specs assert
language fallback by manipulating the `NEXT_LOCALE` cookie or the
`?lang=` query param.

- `i18nCookies.locale` — `'NEXT_LOCALE'`.
