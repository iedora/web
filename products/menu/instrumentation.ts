/**
 * Next.js 16 instrumentation hook — runs once per server process at startup.
 *
 * The Node-only work (OTel registration, postgres-js drain on SIGTERM/SIGINT)
 * lives in `instrumentation.node.ts` and is dynamically imported behind the
 * `NEXT_RUNTIME` gate. Without that split, Turbopack production builds
 * statically detect the `process.on(...)` calls and fail with an Edge
 * Runtime warning even though the calls are guarded at runtime.
 *
 * See https://nextjs.org/docs/app/guides/open-telemetry §"Manual OTel" —
 * the same pattern Next docs recommend for `@opentelemetry/sdk-node`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { registerNode } = await import('./instrumentation.node')
  await registerNode()
}
