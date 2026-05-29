import { getTranslations } from 'next-intl/server'
import { Building2 } from 'lucide-react'
import { Button, Card, CardTitle, CardDesc } from '@iedora/design-system'
import { DashboardPage } from '@iedora/product-menu/shared/ui/dashboard-page'
import {
  EditorialList,
  type EditorialRowData,
} from '@iedora/product-menu/shared/ui/editorial-list'
import { StatusChip } from '@iedora/product-imopush/shared/ui/status-chip'
import {
  listProperties,
  formatPrice,
  formatTypePT,
  formatOperationPT,
} from '@iedora/product-imopush/features/properties'
import { IMOPUSH_PATHS } from '@iedora/product-imopush/url'

const INTEGRATOR_CONFIG = {
  idealista: { label: 'Idealista', Icon: Building2 },
} as const

const INTEGRATORS = Object.keys(INTEGRATOR_CONFIG) as Array<
  keyof typeof INTEGRATOR_CONFIG
>

export default async function ImopushDashboardHome() {
  const t = await getTranslations('Imopush.PropertyList')
  const tProp = await getTranslations('Imopush.Property')
  const properties = await listProperties()

  const actions = (
    <Button
      variant="primary"
      href={IMOPUSH_PATHS.newProperty}
      data-test-id="properties-new"
    >
      {t('newProperty')}
    </Button>
  )

  const rows: EditorialRowData[] = properties.map((p) => {
    const f = p.features ?? {}
    const area = f.constructedAreaSqm ?? p.sizeSqm
    const integrators = p.integrators ?? []

    const stats: string[] = []
    if (p.rooms) stats.push(tProp('rooms', { count: p.rooms }))
    if (area) stats.push(`${area} m²`)
    if (p.bathrooms) stats.push(tProp('bathrooms', { count: p.bathrooms }))

    const extraActions =
      INTEGRATORS.length > 0 ? (
        <>
          {INTEGRATORS.map((key) => {
            const cfg = INTEGRATOR_CONFIG[key]
            const state = integrators.find((i) => i.key === key)?.state
            const variant =
              state === 'published'
                ? 'success'
                : state === 'failed'
                  ? 'danger'
                  : 'neutral'
            return (
              <StatusChip
                key={key}
                label={cfg.label}
                icon={<cfg.Icon size={11} />}
                variant={variant}
              />
            )
          })}
        </>
      ) : undefined

    return {
      id: p.reference,
      href: IMOPUSH_PATHS.property(p.reference),
      title: p.reference,
      image: p.photoUrls?.[0],
      subtitle: (
        <>
          <span>{formatTypePT(p.type)}</span>
          <span aria-hidden="true">·</span>
          <span>{p.address.locality}</span>
        </>
      ),
      metadata: stats.join(' · ') || undefined,
      trailing: {
        value: null,
        label: formatPrice(p.priceCents),
        comparison: formatOperationPT(p.operation),
      },
      extraActions,
    }
  })

  return (
    <DashboardPage title={t('title')} data-test-id="properties" actions={actions}>
      <EditorialList
        testId="properties-list"
        rows={rows}
        emptyState={
          <Card>
            <CardTitle>{t('emptyLabel')}</CardTitle>
            <CardDesc>{t('emptyHint')}</CardDesc>
          </Card>
        }
      />
    </DashboardPage>
  )
}
