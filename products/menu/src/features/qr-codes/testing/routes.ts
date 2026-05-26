export const qrCodesRoutes = {
  admin: '/dashboard/admin/qr-codes',
  public: (code: string) => `/q/${code}`,
} as const
