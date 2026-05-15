import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { SignupForm } from './signup-form'

export default async function SignupPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect('/')
  return <SignupForm />
}
