import pino, { type Logger } from 'pino'

/**
 * Process-wide structured logger. One pino instance, used by every
 * server-side log call in the menu app.
 *
 * Why pino, not `console.*`:
 *   - `@opentelemetry/instrumentation-pino` (wired by
 *     `@iedora/observability` at startup) injects `trace_id` / `span_id`
 *     onto every record AND forwards them through the global
 *     LoggerProvider to OpenObserve. With `console.*`, records hit
 *     stdout only and lose trace correlation.
 *   - Structured fields (`log.info({ restaurantId }, 'msg')`) become
 *     queryable in OO without parsing free-text. Dashboards filter on
 *     `attributes.restaurant_id`, not on grep against the message body.
 *
 * Level: `info` in production, `debug` in dev. Override with `LOG_LEVEL`
 * env (e.g. `LOG_LEVEL=trace` for a verbose investigation).
 *
 * Transport: stdout, line-delimited JSON. Container logs ship via
 * journald → OO log pipeline (when wired) or are tailed locally via
 * `just infra::logs menu_web`. We deliberately don't enable
 * pino-pretty here — production stdout must stay JSON for the OO
 * ingest to parse. Dev users who want pretty output can pipe through
 * pino-pretty manually (`bun run dev | pino-pretty`).
 *
 * Why a single shared instance, not per-module child loggers:
 *   - Bind module-specific fields at the call site: `log.info({ module:
 *     'identity' }, 'msg')`. Avoids the import sprawl of `createLogger`
 *     factories.
 *   - The OTel pino instrumentation requires-hook hooks ALL pino
 *     instances, but having a single one is one less moving part and
 *     guarantees uniform configuration.
 */
export const log: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // Suppress hostname + pid bloat — Resource attributes (service.name,
  // host.name) on the OTel record already carry that, and stdout-mode
  // logs in containers also stamp them. Keeping the body lean.
  base: undefined,
  // ISO timestamps — matches the OTel log record's observedTimestamp
  // shape and is the only sane choice in containers (epoch-millis
  // numbers are unreadable in journalctl).
  timestamp: pino.stdTimeFunctions.isoTime,
})
