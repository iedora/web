import { auth } from '@/features/auth/adapters/better-auth-instance'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth.handler)
