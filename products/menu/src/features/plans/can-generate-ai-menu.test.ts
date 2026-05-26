import { describe, expect, it, vi } from 'vitest'
import type { PlansGateway } from './ports'
import { canGenerateAiMenu } from './use-cases/can-generate-ai-menu'

vi.mock('server-only', () => ({}))

function makeFake({
  plan,
  used,
}: {
  plan: string | null
  used: number
}): PlansGateway {
  return {
    getOrgPlan: async () => plan,
    countOrgRestaurants: async () => 0,
    updateOrgPlan: async () => true,
    countAiGenerationsSince: async () => used,
    recordAiGeneration: async () => {},
  }
}

const NOW = new Date('2026-05-22T12:00:00.000Z')

describe('canGenerateAiMenu', () => {
  it('Free allows the first generation but blocks the second', async () => {
    const allowed = await canGenerateAiMenu(
      makeFake({ plan: 'free', used: 0 }),
      'org-1',
      NOW,
    )
    expect(allowed).toEqual({
      ok: true,
      limit: 1,
      used: 0,
      resetAt: NOW,
    })

    const blocked = await canGenerateAiMenu(
      makeFake({ plan: 'free', used: 1 }),
      'org-1',
      NOW,
    )
    expect(blocked).toEqual({
      ok: false,
      reason: 'ai-weekly-limit',
      limit: 1,
      used: 1,
      resetAt: NOW,
    })
  })

  it('Casa lets through up to 5 generations per week and rejects the 6th', async () => {
    const fifth = await canGenerateAiMenu(
      makeFake({ plan: 'casa', used: 4 }),
      'org-1',
      NOW,
    )
    expect(fifth.ok).toBe(true)
    expect(fifth.limit).toBe(5)

    const sixth = await canGenerateAiMenu(
      makeFake({ plan: 'casa', used: 5 }),
      'org-1',
      NOW,
    )
    expect(sixth.ok).toBe(false)
    if (sixth.ok) throw new Error('unreachable')
    expect(sixth.limit).toBe(5)
    expect(sixth.used).toBe(5)
    expect(sixth.reason).toBe('ai-weekly-limit')
  })

  it('queries generations in the rolling 7-day window', async () => {
    const fake: PlansGateway = {
      getOrgPlan: async () => 'free',
      countOrgRestaurants: async () => 0,
      updateOrgPlan: async () => true,
      countAiGenerationsSince: vi.fn(async () => 0),
      recordAiGeneration: async () => {},
    }
    await canGenerateAiMenu(fake, 'org-1', NOW)
    const expectedSince = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000,
    )
    expect(fake.countAiGenerationsSince).toHaveBeenCalledWith(
      'org-1',
      expectedSince,
    )
  })

  it('unknown plan codes fall back to the default (free) limits', async () => {
    const gate = await canGenerateAiMenu(
      makeFake({ plan: 'enterprise-imaginary', used: 0 }),
      'org-1',
      NOW,
    )
    expect(gate.ok).toBe(true)
    expect(gate.limit).toBe(1)
  })
})
