/**
 * Public API of the menu-translation slice.
 *
 * Server actions live at `@/features/menu-translation/actions` per the
 * 'use server' / barrel rule (AGENTS.md). UI components — none today;
 * the refresh button is a single inline client component in the
 * restaurant page composition.
 */
export type {
  TranslatableField,
  TranslatedField,
  TranslationPort,
  TranslationDataPort,
  StaleRow,
  WriteUpdate,
} from './ports'

export type { RefreshResult } from './use-cases/refresh-translations'
