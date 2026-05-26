export const restaurantIdentityRoutes = {
  home: (slug: string) => `/dashboard/r/${slug}`,
  theme: (slug: string) => `/dashboard/r/${slug}/theme`,
  qr: (slug: string) => `/dashboard/r/${slug}/qr`,
} as const
