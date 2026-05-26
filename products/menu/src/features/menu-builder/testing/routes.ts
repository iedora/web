export const menuBuilderRoutes = {
  builder: (slug: string, menuId: string) => `/dashboard/r/${slug}/m/${menuId}`,
} as const
