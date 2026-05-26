export const menuPublishingRoutes = {
  public: (slug: string) => `/r/${slug}`,
  track: (slug: string) => `/api/track/${slug}`,
} as const
