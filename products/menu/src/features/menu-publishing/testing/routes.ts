export const menuPublishingRoutes = {
  public: (slug: string) => `/r/${slug}`,
  track: (slug: string) => `/track/${slug}`,
} as const
