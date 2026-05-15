// Public surface of the templates module. Internals (per-template folders,
// the registry, the type module) are reachable from outside but consumers
// should prefer this barrel so the module's contract stays stable.
export type { MenuTemplate, TemplateId, TemplateMeta } from './types'
export { TEMPLATES, TEMPLATE_META, getTemplate } from './registry'
