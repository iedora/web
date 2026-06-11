import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Card, CardDesc, CardTitle } from '@iedora/design-system'
import { getSession } from '@iedora/api-client'
import { isSameIedoraOrigin, PRODUCTS, productUrl } from '@iedora/brand'
import { SignUpForm } from './sign-up-form'

type Props = {
  searchParams: Promise<{ next?: string }>
}

export default async function SignUpPage({ searchParams }: Props) {
  const t = await getTranslations('Auth.signUp')
  const { next: rawNext } = await searchParams
  const next = isSameIedoraOrigin(rawNext) ? rawNext! : productUrl(PRODUCTS.menu)

  const session = await getSession()
  if (session) {
    redirect(next)
  }

  return (
    <Card>
      <CardTitle as="h2">{t('title')}</CardTitle>
      <CardDesc>{t('subtitle')}</CardDesc>
      <SignUpForm next={next} />
    </Card>
  )
}
