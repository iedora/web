/**
 * @iedora/product-house — apex brand landing for iedora.com.
 *
 * Public API: a single Next.js page module re-exported here. Consumers
 * (apps/web/src/app/house/page.tsx) re-export `default` + `metadata`
 * to mount the page at a host-aware route, with `proxy.ts` rewriting
 * the apex host into `/house/*` internally.
 */
export { default, metadata } from './landing-page'
