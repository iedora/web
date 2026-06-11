import { getTranslations } from 'next-intl/server'
import { Card, CardDesc, CardTitle } from '@iedora/design-system'
import { brandUrl, isSameIedoraOrigin } from '@iedora/brand'
import { SignOutAction } from './sign-out-action'

type Props = {
  searchParams: Promise<{ next?: string }>
}

/**
 * Calls `authClient.signOut()` on mount, then redirects to `next`
 * (validated) or the brand landing. The action runs on the client so
 * the Set-Cookie reaches the browser through the same response that
 * triggered the navigation — top-level redirect from a server action
 * would also work, but the client form makes the round-trip visible
 * (loading copy → final destination).
 */
export default async function SignOutPage({ searchParams }: Props) {
  const t = await getTranslations('Auth.signOut')
  const { next: rawNext } = await searchParams
  const next = isSameIedoraOrigin(rawNext) ? rawNext! : brandUrl()

  return (
    <Card>
      <CardTitle as="h2">{t('title')}</CardTitle>
      <CardDesc>{t('body')}</CardDesc>
      <SignOutAction next={next} />
    </Card>
  )
}
