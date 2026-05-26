import { template as classic } from './classic'
import { template as minimal } from './minimal'
import type { MenuTemplate, TemplateId, TemplateMeta } from './types'

// Adding a template = create features/menu-publishing/rsc/templates/<id>/, export `template`
// from its index.ts, then add a single import + entry below. Keep this file
// short on purpose — every template's surface lives in its own folder.
const REGISTRY: Record<TemplateId, MenuTemplate> = {
  classic,
  minimal,
}

export function getTemplate(id: string): MenuTemplate {
  return (REGISTRY as Record<string, MenuTemplate>)[id] ?? REGISTRY.classic
}

export const TEMPLATES: readonly MenuTemplate[] = Object.values(REGISTRY)

export const TEMPLATE_META: readonly TemplateMeta[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
}))
