'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { authClient } from '@/features/auth/client'
import { Button } from '@/shared/ui/button'

export function LogoutButton() {
  const router = useRouter()
  const t = useTranslations('AppHeader')
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut()
        router.push('/login')
        router.refresh()
      }}
    >
      {t('logout')}
    </Button>
  )
}
