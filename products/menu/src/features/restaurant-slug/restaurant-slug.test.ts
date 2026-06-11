import { describe, expect, it } from 'vitest'
import { isValidSlugShape, slugify } from './slugify'

// ── Pure helpers ────────────────────────────────────────────────────────────
// Allocation / rename behaviour lives in the Go menu service and is
// covered by its own integration tests; only the pure, framework-free
// helpers are tested here.

describe('slugify', () => {
  it.each([
    ['Sushi Akira', 'sushi-akira'],
    ['  Bom   Garfo  ', 'bom-garfo'],
    ['Cafe São Bento', 'cafe-sao-bento'],
    ['ALL CAPS LIKE!!!', 'all-caps-like'],
    ['já-existing-hyphens', 'ja-existing-hyphens'],
    ['multiple---dashes', 'multiple-dashes'],
    ['-leading-and-trailing-', 'leading-and-trailing'],
    ['', 'restaurant'],
    ['🍣🍣🍣', 'restaurant'],
    ['...!!!', 'restaurant'],
    ['012345', '012345'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps at 40 chars', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long)).toBe('a'.repeat(40))
  })
})

describe('isValidSlugShape', () => {
  it.each([
    ['ab', true],
    ['sushi-akira', true],
    ['restaurant-2', true],
    ['012345', true],
    ['a', false], // too short
    ['-foo', false], // leading dash
    ['foo-', false], // trailing dash
    ['UPPER', false], // uppercase
    ['has spaces', false],
    ['has_underscore', false], // underscores not allowed
    ['a'.repeat(41), false], // over 40 chars
  ])('%s → %s', (input, expected) => {
    expect(isValidSlugShape(input)).toBe(expected)
  })
})
