/**
 * Active AI provider for menu-import. One line, on purpose: swapping
 * provider is a single-file change here. Per-provider implementation
 * lives in `ai-<name>.ts`; cross-provider helpers in `ai-shared.ts`.
 *
 *   import { menuAnalysisAdapter } from './ai-kimi'        // current
 *   import { menuAnalysisAdapter } from './ai-openai'      // future
 *   import { menuAnalysisAdapter } from './ai-claude'      // future
 *
 * Consumers (server actions, use-cases) depend on `ImageAnalysisPort`,
 * never on the concrete adapter — `actions.ts` always imports
 * `menuAnalysisAdapter` from this file.
 */
import 'server-only'
import { createKimiAdapter } from './ai-kimi'

export const menuAnalysisAdapter = createKimiAdapter()
