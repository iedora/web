/**
 * @iedora/core-tenancy — cross-product tenant state projection.
 *
 * Each product writes a snapshot of its own onboarding/lifecycle
 * state into `core.tenant_product_state` after every mutation; the
 * core admin reads the snapshot to render a generic "Products"
 * section per tenant. No FKs across product DBs, no direct
 * cross-product imports — products talk to this package, this
 * package talks to core.
 */

export {
  projectProductState,
  getProductState,
  listTenantProductStates,
} from './projection'
export { tenantProductState, type TenantProductStateRow } from './schema'
