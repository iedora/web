'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { completeOnboarding, type OnboardingFormState } from './actions'

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingFormState, FormData>(
    completeOnboarding,
    undefined,
  )
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your first restaurant</CardTitle>
        <CardDescription>
          You can rename or add more later. The slug is used in your public menu URL.
        </CardDescription>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="restaurantName">Restaurant name</Label>
            <Input
              id="restaurantName"
              name="restaurantName"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }}
              placeholder="O Bom Garfo"
            />
            {state?.fieldErrors?.restaurantName && (
              <p className="text-sm text-destructive">{state.fieldErrors.restaurantName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">URL slug</Label>
            <div className="flex items-center gap-1 rounded-md border px-3 focus-within:ring-1 focus-within:ring-ring">
              <span className="text-sm text-muted-foreground">metamenu.app/r/</span>
              <Input
                id="slug"
                name="slug"
                type="text"
                required
                minLength={2}
                maxLength={40}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value.toLowerCase())
                }}
                className="border-0 px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            {state?.fieldErrors?.slug && (
              <p className="text-sm text-destructive">{state.fieldErrors.slug}</p>
            )}
          </div>
          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Creating…' : 'Create restaurant'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
