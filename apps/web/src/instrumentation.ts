import { registerIedoraOtel } from '@iedora/observability'

/**
 * Next.js instrumentation entrypoint — invoked once per worker on boot.
 * Gated on the Node runtime so the Edge runtime (where most OTel SDKs
 * don't run) is skipped silently.
 *
 * Telemetry só flui se OTEL_EXPORTER_OTLP_ENDPOINT estiver definido (em
 * prod via Kamal env.clear, em dev via apps/web/.env.local). Sem endpoint
 * o registerIedoraOtel loga um warning e segue — app continua sem OTel.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  registerIedoraOtel({ serviceName: 'iedora-web' })
}
