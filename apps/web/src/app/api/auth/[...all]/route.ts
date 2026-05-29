import { toNextJsHandler } from '@iedora/core-auth/next'

export const dynamic = 'force-dynamic'

async function getHandler() {
  const { auth } = await import('@iedora/core-auth')
  return toNextJsHandler(auth.handler)
}

export async function GET(req: Request) {
  return (await getHandler()).GET(req)
}

export async function POST(req: Request) {
  return (await getHandler()).POST(req)
}
