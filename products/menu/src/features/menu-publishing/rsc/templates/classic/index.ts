import type { MenuTemplate } from '../types'
import { ClassicMenu } from './classic-menu'
import { meta } from './meta'

export const template: MenuTemplate = { ...meta, Component: ClassicMenu }
