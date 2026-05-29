'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@iedora/design-system'
import { useToast } from '../../../shared/ui/toasts'
import { publishToIdealista } from '../actions'

type Props = {
  reference: string
  /** Show smaller label after a previous failure. */
  retry?: boolean
}

export function PublishIdealistaButton({ reference, retry }: Props) {
  const t = useTranslations('Imopush.IdealistaPublish')
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  function onClick() {
    startTransition(async () => {
      const result = await publishToIdealista(reference)
      if (!result.ok) {
        toast.show({
          title: t('publish'),
          message: result.error,
          variant: 'warn',
        })
      }
    })
  }

  return (
    <Button
      type="button"
      variant="primary"
      onClick={onClick}
      disabled={isPending}
      data-test-id={`idealista-publish-${reference}`}
    >
      {isPending ? t('publishing') : retry ? t('retry') : t('publish')}
    </Button>
  )
}
