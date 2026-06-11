// Host-to-surface topology consumed by src/proxy.ts and per-surface pages.
// Hand-maintained — adding a new surface here is rule #5 in apps/web/CLAUDE.md.
// (Previously emitted by `iedora emit-topology`, retired with the Go pipeline.)

import { BRAND_DOMAIN, PRODUCTS } from '@iedora/brand'

export type Surface = {
  readonly name: string
  readonly hosts: ReadonlyArray<string>
  // URL prefix proxy.ts rewrites traffic under (e.g. "/menu").
  // Empty string means this surface owns the URL root (no rewrite).
  readonly rewritePath: string
  /**
   * Top-level URL segments the surface's slice code emits WITHOUT the
   * `rewritePath` prefix (e.g. the menu slice generates `/dashboard/...`,
   * not `/menu/dashboard/...`, because it expects to run under
   * `menu.<host>` where the host rewrite adds the prefix). Used by
   * proxy.ts to make those paths resolvable on plain `localhost`
   * (no subdomain) too. Each entry is matched as either an exact path
   * or a prefix with a trailing `/`.
   *
   * Keep aligned with the directories under `apps/web/src/app/<surface>/`.
   */
  readonly aliasPaths?: ReadonlyArray<string>
}

export const surfaces: ReadonlyArray<Surface> = [
  {
    name: "house",
    hosts: [BRAND_DOMAIN, `www.${BRAND_DOMAIN}`],
    rewritePath: "/house",
  },
  {
    name: PRODUCTS.menu,
    hosts: [`menu.${BRAND_DOMAIN}`, "menu.localhost"],
    rewritePath: "/menu",
    aliasPaths: [
      "/dashboard",
      "/onboarding",
      "/r",
      "/q",
      "/showcase",
      "/sign-in",
      "/sign-up",
      "/sign-out",
    ],
  },
]

// surfaceByHost returns the surface whose host list contains `host`,
// or undefined. O(N) over a small list — no map needed.
export function surfaceByHost(host: string): Surface | undefined {
  return surfaces.find((s) => s.hosts.includes(host))
}
