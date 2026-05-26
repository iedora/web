import type { ComponentType } from 'react'
import type { RestaurantTheme } from '@/shared/db/schema'
import type { RenderProps } from '../types'

export type TemplateId = NonNullable<RestaurantTheme['layout']>

export type TemplateMeta = {
  id: TemplateId
  name: string
  description: string
}

export type MenuTemplate = TemplateMeta & {
  Component: ComponentType<RenderProps>
}
