/**
 * Next.js integration re-exports. Consumers that need to mount the
 * better-auth handler under `/api/auth/[...all]` import from here —
 * NOT from `better-auth/next-js` directly. Keeps the cross-product
 * boundary contract (`README.md` § "Cross-product boundary") honest:
 * products talk to the auth surface ONLY through `@iedora/core-auth`.
 */
export { toNextJsHandler } from 'better-auth/next-js'
