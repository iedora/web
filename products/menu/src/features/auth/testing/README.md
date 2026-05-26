# auth/testing — slice E2E surface

Exports — see [docs/testing.md](/docs/testing.md) for the contract:

- `signInAs(context, { email, name, profile, organizationId? })` —
  inserts a `menu.session` row + injects the JWE pointer cookie. Mirrors
  `/api/auth/callback` so the production DAL sees a real session.
- `signOut(context)` — drops the cookie.
- `iedoraAdminProfile` — `[iedora-admin]` role + every scope in
  `../scopes.ts` (matches the production bundle expansion).
- `memberProfile` — authenticated, zero scopes. Use to assert denial.
- `authRoutes` — `/api/auth/{login,callback,logout}` constants.

`signInAs` is structurally identical to the OIDC callback: same cookie
format, same row layout. If the production callback changes, so must
this helper — that's why it lives in the slice, not in
`tests/e2e/helpers/`.
