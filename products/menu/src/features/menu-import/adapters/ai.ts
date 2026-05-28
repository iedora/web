/**
 * Active AI provider for menu-import. One line, on purpose: swapping
 * provider is a single-file change here. Per-provider implementation
 * lives in `ai-<name>.ts`; cross-provider helpers in `ai-shared.ts`.
 *
 * Consumers (server actions, use-cases) depend on `ImageAnalysisPort`,
 * never on the concrete adapter — `actions.ts` always imports
 * `menuAnalysisAdapter` from this file.
 */
import 'server-only'
import { createDeepseekAdapter } from './ai-deepseek'

export const menuAnalysisAdapter = createDeepseekAdapter()
