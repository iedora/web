/**
 * Audit-read slice barrel. Read-only — write path is in
 * `@iedora/core-auth/audit::recordAudit`. Adapters live under `./adapters/`,
 * use-cases under `./use-cases/`.
 */

export { drizzleAuditGateway } from './adapters/drizzle'
export { listEvents } from './use-cases/list-events'
export type {
  AuditEntry,
  AuditGateway,
  ListAuditInput,
  ListAuditResult,
} from './ports'
