/**
 * i18n is a cross-cutting concern — language is set per public-menu visit
 * via a cookie (`NEXT_LOCALE`) and reflected in `?lang=` query for shared
 * links. Routes themselves belong to menu-publishing.
 */
export const i18nCookies = {
  locale: 'NEXT_LOCALE',
} as const
