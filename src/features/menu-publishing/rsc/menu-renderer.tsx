import type { CSSProperties } from 'react'
import { fontCssVar } from './theme'
import { getTemplate } from './templates'
import type { RenderProps } from './types'

export function MenuRenderer(props: RenderProps) {
  const { theme } = props
  const { Component } = getTemplate(theme.layout)

  // CSS variables drive colors so the same JSX renders both server-side and
  // in the dashboard live preview without prop drilling colors into every
  // descendant.
  const style = {
    '--menu-primary': theme.primaryColor,
    '--menu-secondary': theme.secondaryColor,
    fontFamily: `var(${fontCssVar(theme.font)})`,
    color: 'var(--menu-primary)',
  } as CSSProperties

  return (
    <div style={style}>
      <Component {...props} />
    </div>
  )
}
