import type { MenuTemplate } from '../types'
import { MinimalMenu } from './minimal-menu'
import { meta } from './meta'

export const template: MenuTemplate = { ...meta, Component: MinimalMenu }
