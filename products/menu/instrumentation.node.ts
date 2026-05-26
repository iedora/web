/**
 * Node-only instrumentation. Imported dynamically from `instrumentation.ts`
 * ONLY when `process.env.NEXT_RUNTIME === 'nodejs'`, so Next 16's Edge
 * Runtime static analysis never sees `process.on(...)` or the postgres-js
 * client. Without this split, Turbopack production builds fail with
 * "A Node.js API is used (process.on at line: X) which is not supported
 * in the Edge Runtime" — the static checker doesn't understand the
 * runtime guard in the parent module.
 */
import { registerIedoraOtel } from '@iedora/observability'

export async function registerNode() {
  // Register OTel FIRST — the pino instrumentation registers a
  // require-hook around `pino`, and that hook must be in place BEFORE
  // any pino logger is constructed. Importing the shared logger after
  // registerIedoraOtel guarantees the bridge picks up the instance.
  registerIedoraOtel({ serviceName: 'iedora-menu' })

  const [{ closeDb }, { log }] = await Promise.all([
    import('@/shared/db/client'),
    import('@/shared/log'),
  ])

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal, module: 'instrumentation' }, 'shutdown signal received, draining DB')
    try {
      await closeDb({ timeout: 5 })
      log.info({ module: 'instrumentation' }, 'DB drained')
    } catch (err) {
      log.error({ err, module: 'instrumentation' }, 'DB drain failed')
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
