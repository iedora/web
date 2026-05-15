import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/features/auth/adapters/better-auth-instance'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect('/')
  return <LoginForm />
}
