import { requireScope } from '@iedora/product-core'
import { SCOPES, type Scope } from '@iedora/core-auth/scopes'
import { detectStaffPreset } from '@iedora/core-auth'
import { AdminShell } from '@iedora/product-core/shared/ui/admin-shell'

/**
 * Admin chrome — runs at /core/admin/*. Gates on the
 * `staff:core:admin:read` scope (held by every staff role, missing
 * for tenant users). Each nested page tightens via `requireScope`
 * for the narrower verb the page touches.
 */
export default async function CoreAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireScope(SCOPES.core.staff.admin.read)
  const userScopes =
    ((session.user as { scopes?: string[] | null }).scopes ?? null) as
      | readonly Scope[]
      | null
  const staffRoleLabel = userScopes ? detectStaffPreset(userScopes) : null
  return (
    <AdminShell
      userEmail={session.user.email}
      userScopes={userScopes}
      staffRoleLabel={staffRoleLabel}
    >
      {children}
    </AdminShell>
  )
}
