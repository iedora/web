# qr-codes/testing — slice E2E surface

QR codes are cross-tenant (iedora-staff only), so the profile is
`iedoraAdminProfile` (re-exported from auth).

- `seedQrCode({ code, restaurantId?, label? })` — insert. Unbound = no
  restaurantId.
- `qrCodesRoutes.admin` — `/dashboard/admin/qr-codes`.
- `qrCodesRoutes.public(code)` — `/q/{code}` redirect endpoint.
