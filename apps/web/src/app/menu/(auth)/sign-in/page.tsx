import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Card, CardDesc, CardTitle } from '@iedora/design-system'
import { getSession } from '@iedora/api-client'
import { isSameIedoraOrigin, PRODUCTS, productUrl } from '@iedora/brand'
import { SignInForm } from './sign-in-form'

type Props = {
  searchParams: Promise<{ next?: string }>
}

/**
 * Sign-in page. RSC shell — pulls the translations + the
 * validated `next` URL and hands off to the client form (which submits
 * to the `signInAction` server action against the Go auth service).
 */
export default async function SignInPage({ searchParams }: Props) {
  const t = await getTranslations('Auth.signIn')
  const { next: rawNext } = await searchParams

  // If already signed in, skip the form. Honour `next` when it points
  // at a trusted iedora-family origin; fall back to the menu app.
  const session = await getSession()
  const next = isSameIedoraOrigin(rawNext) ? rawNext! : productUrl(PRODUCTS.menu)
  if (session) {
    redirect(next)
  }

  return (
    <Card>
      <CardTitle as="h2">{t('title')}</CardTitle>
      <CardDesc>{t('subtitle')}</CardDesc>
      <SignInForm next={next} />
    </Card>
  )
}
