/**
 * Canonical project-role keys asserted by Zitadel on the iedora project. The
 * key strings must match the `role_key` of the corresponding TF-declared
 * `zitadel_project_role` resources (see `infra/iac/tofu/zitadel.tf`). Keep this
 * file framework-free — it's imported from server use-cases AND tests, and
 * MUST NOT depend on `next` or `server-only`.
 */

/**
 * Cross-product Iedora-staff role. Anyone granted this role on the iedora
 * project gets it across every OIDC app under that project (menu today,
 * future products tomorrow). Use `requireIedoraAdmin` (in `@/features/auth`)
 * to gate admin surfaces.
 */
export const IEDORA_ADMIN_ROLE = 'iedora-admin'
