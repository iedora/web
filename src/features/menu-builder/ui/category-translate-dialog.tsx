'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { LocalizedFields } from '@/features/i18n/ui/localized-fields'
import type { LanguageCode, LocalizedText } from '@/features/i18n'
import { updateCategoryTranslations } from '@/features/menu-builder/actions'

// Opens from a "Translate" button next to the category title. Renders only
// when supportedLanguages.length > 1 — single-language menus keep the inline
// rename UX they already had.
export function CategoryTranslateDialog({
  slug,
  categoryId,
  defaultLanguage,
  supportedLanguages,
  initial,
}: {
  slug: string
  categoryId: string
  defaultLanguage: LanguageCode
  supportedLanguages: LanguageCode[]
  initial: {
    name: string
    description: string | null
    nameI18n: LocalizedText | null
    descriptionI18n: LocalizedText | null
  }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [nameI18n, setNameI18n] = useState<LocalizedText>(initial.nameI18n ?? {})
  const [descriptionI18n, setDescriptionI18n] = useState<LocalizedText>(
    initial.descriptionI18n ?? {},
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await updateCategoryTranslations(slug, categoryId, {
        name: name.trim(),
        description: description.trim(),
        nameI18n,
        descriptionI18n,
      })
      if (res && 'error' in res) {
        setError(res.error ?? 'Could not save')
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid={`category-translate-${categoryId}`}
          >
            Translate
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <LocalizedFields
            id="category"
            defaultLanguage={defaultLanguage}
            supportedLanguages={supportedLanguages}
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            nameI18n={nameI18n}
            onNameI18nChange={setNameI18n}
            descriptionI18n={descriptionI18n}
            onDescriptionI18nChange={setDescriptionI18n}
            nameMaxLength={80}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending}
              data-testid="category-translate-save"
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
