import 'server-only'
import type { PlansGateway } from '../ports'

/**
 * Logs that an AI menu-import generation just ran. Counter is derived
 * from these rows by `canGenerateAiMenu`. Call this from the action
 * shell AFTER a successful Gemini response — failed parses don't
 * consume a slot.
 */
export async function recordAiGeneration(
  plans: PlansGateway,
  organizationId: string,
): Promise<void> {
  await plans.recordAiGeneration(organizationId)
}
