// Next.js route segment config must be statically parseable at this exact
// path (it can't be re-exported from a workspace package — the compiler
// walks the AST of the file at the route slot). Declare `dynamic` here;
// the handler itself lives in @iedora/product-menu.
export const dynamic = 'force-dynamic'
export { GET } from '@iedora/product-menu/app/up/route'
