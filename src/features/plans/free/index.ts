import type { Plan } from '../types'

export const plan: Plan = {
  code: 'free',
  englishName: 'Free',
  limits: { restaurants: 1, monthlyViews: 1000 },
  features: new Set(),
  isDefault: true,
}
