/**
 * Bundle → scopes mapping. **Single source of truth.** Consumed by the
 * Zitadel Action webhook at `/api/zitadel/permissions` to expand the
 * user's bundle role-grants into a flat `permissions` claim on the
 * id_token + access_token.
 *
 * When a second iedora product needs the same expansion, point its
 * Zitadel target at the same webhook — don't duplicate the map.
 *
 * Naming convention used by the webhook:
 *   - Role key WITHOUT `:` → bundle. Look up here; expand to scopes.
 *   - Role key WITH `:`    → atomic permission. Pass through unchanged.
 *
 * Adding a scope to a bundle is a one-line edit + deploy: no Zitadel
 * UI dance, no per-user re-grant. Adding a new bundle = one entry here
 * + one `zitadel_project_role` in TF.
 */

import { ALL_SCOPES, SCOPES, type Scope } from './scopes'
import { IEDORA_ADMIN_ROLE } from './roles'

export const BUNDLES: Record<string, ReadonlyArray<Scope>> = {
  // `iedora-admin` is the wildcard bundle — full Iedora-staff access. By
  // resolving to `ALL_SCOPES`, every scope added to `scopes.ts` lands in
  // the admin's permissions on next sign-in, without anyone having to
  // remember to extend this map. The trade-off is explicit: admins get
  // *every* new capability automatically — design new scopes accordingly
  // (introduce a narrower bundle if a capability should NOT default-on
  // for admins).
  [IEDORA_ADMIN_ROLE]: ALL_SCOPES,
}

/**
 * Expand a list of role keys (as granted in Zitadel) into the union of
 * concrete scopes. Bundle keys resolve via `BUNDLES`; atomic keys
 * (containing `:`) pass through if they're known scopes. Unknown keys
 * are dropped defensively — better silent than to honour something we
 * didn't define.
 */
export function expandRolesToScopes(roleKeys: ReadonlyArray<string>): Scope[] {
  const out = new Set<Scope>()
  for (const key of roleKeys) {
    if (key.includes(':')) {
      // Atomic — only accept if it's in our declared scope set.
      const knownScope = (Object.values(SCOPES) as string[]).find(
        (s) => s === key,
      )
      if (knownScope) out.add(knownScope as Scope)
      continue
    }
    const bundle = BUNDLES[key]
    if (bundle) for (const s of bundle) out.add(s)
  }
  return Array.from(out)
}
