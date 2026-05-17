'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldHint,
  FieldInput,
  FieldLabel,
  FieldTextarea,
} from '@iedora/design-system'
import { registerApplicationAction, rotateJwksAction } from './actions'
import { KNOWN_SCOPES } from './_scopes'

/**
 * "Rotate now" trigger for the JWKS active signing key. Wrapped in a
 * confirm dialog because:
 *   - it's a destructive-ish lever (forces new tokens to be signed with
 *     a new key) and the admin should be intentional about hitting it;
 *   - the server action is step-up gated, so an admin with a stale
 *     session is bounced to /reauth before the rotation runs.
 *
 * On success the page revalidates and the JWKS section re-renders with
 * the new active key id + timestamp. The dialog stays open just long
 * enough to confirm the new kid so an operator can copy it.
 */
export function RotateJwksDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [newKeyId, setNewKeyId] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setError(null)
          setNewKeyId(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">Rotate now</Button>
      </DialogTrigger>
      <DialogContent eyebrow="/ Dialog · Rotate JWKS key">
        <DialogHeader>
          <DialogTitle>Rotate the JWKS signing key?</DialogTitle>
          <DialogDescription>
            Mints a new RSA/EdDSA key pair and makes it the active signer
            for all new tokens. The previous key stays in the published
            JWKS so existing tokens still validate against their{' '}
            <code>kid</code>. Use this for compromised-key emergencies —
            the automatic 90-day rotation runs in the background.
          </DialogDescription>
        </DialogHeader>
        {newKeyId ? (
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--ink-70)',
              margin: '12px 0',
            }}
            role="status"
          >
            Rotated. New active <code>kid</code>: <code>{newKeyId}</code>
          </p>
        ) : null}
        {error ? (
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--danger, #b00)',
              margin: '12px 0',
            }}
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{newKeyId ? 'Close' : 'Cancel'}</Button>
          </DialogClose>
          {newKeyId ? null : (
            <Button
              type="button"
              variant="accent"
              arrow
              disabled={pending}
              onClick={() => {
                setError(null)
                startTransition(async () => {
                  const res = await rotateJwksAction()
                  if (res.ok) {
                    setNewKeyId(res.newKeyId)
                    router.refresh()
                  } else {
                    setError(res.error)
                  }
                })
              }}
            >
              {pending ? 'Rotating…' : 'Rotate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RegisterApplicationDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="solid" arrow>
          Register application
        </Button>
      </DialogTrigger>
      <DialogContent eyebrow="/ Dialog · Register OAuth client">
        <DialogHeader>
          <DialogTitle>Register an OAuth client</DialogTitle>
          <DialogDescription>
            Issues a fresh <code>client_id</code> and <code>client_secret</code>.
            Pin the secret straight away — it’s shown once on the next page.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            const fd = new FormData(e.currentTarget)
            startTransition(async () => {
              const res = await registerApplicationAction(fd)
              if (res.ok) {
                setOpen(false)
                router.push(
                  res.internalId
                    ? `/admin/applications/${res.internalId}`
                    : '/admin/applications',
                )
                router.refresh()
              } else {
                setError(res.error)
              }
            })
          }}
        >
          <div style={{ display: 'grid', gap: 20 }}>
            <Field error={Boolean(error)}>
              <FieldLabel htmlFor="client_name">Name</FieldLabel>
              <FieldInput
                id="client_name"
                name="client_name"
                type="text"
                placeholder="Acme dashboard"
                required
              />
              <FieldHint>Shown on the consent screen.</FieldHint>
            </Field>
            <Field error={Boolean(error)}>
              <FieldLabel htmlFor="redirect_uris">Redirect URIs</FieldLabel>
              <FieldTextarea
                id="redirect_uris"
                name="redirect_uris"
                rows={4}
                placeholder={'https://app.example.com/api/auth/callback\nhttps://localhost:3000/api/auth/callback'}
                required
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
              <FieldHint>One per line. Absolute URLs only.</FieldHint>
            </Field>
            <Field>
              <FieldLabel>Scope</FieldLabel>
              <div
                role="group"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px 18px',
                  marginTop: 6,
                }}
              >
                {KNOWN_SCOPES.map((s) => (
                  <label
                    key={s}
                    style={{
                      display: 'inline-flex',
                      gap: 8,
                      alignItems: 'center',
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                      letterSpacing: '0.04em',
                    }}
                  >
                    <input
                      type="checkbox"
                      name="scope"
                      value={s}
                      defaultChecked={
                        s === 'openid' || s === 'profile' || s === 'email'
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
              {error ? (
                <FieldHint role="alert">{error}</FieldHint>
              ) : (
                <FieldHint>Pick what the client may request.</FieldHint>
              )}
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="accent" arrow disabled={pending}>
              {pending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
