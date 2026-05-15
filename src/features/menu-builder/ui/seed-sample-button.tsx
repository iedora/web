'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/shared/ui/button'
import { seedSampleMenu } from '@/features/menu-builder/actions'

export function SeedSampleButton({ slug }: { slug: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const t = useTranslations('Restaurant')
  const tc = useTranslations('Common')

  function onClick() {
    startTransition(async () => {
      const res = await seedSampleMenu(slug)
      if ('ok' in res) {
        router.push(`/dashboard/r/${slug}/m/${res.menuId}`)
      }
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={pending}
      data-testid="seed-sample-menu"
    >
      {pending ? tc('saving') : t('sampleMenu')}
    </Button>
  )
}
