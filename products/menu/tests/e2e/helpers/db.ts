import postgres from 'postgres'

const TEST_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:Password1!@localhost:5432/menu_test'

let _sql: ReturnType<typeof postgres> | null = null

export function testDb() {
  if (!_sql) _sql = postgres(TEST_URL, { max: 4 })
  return _sql
}

export async function closeTestDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 })
    _sql = null
  }
}

export async function truncateAll(): Promise<void> {
  const sql = testDb()
  await sql`
    TRUNCATE TABLE
      "menu"."view_seen", "menu"."daily_view", "menu"."invoice",
      "menu"."item", "menu"."category", "menu"."menu",
      "menu"."restaurant", "menu"."org_plan",
      "menu"."session", "menu"."rate_limit_event"
    RESTART IDENTITY CASCADE
  `
}

export async function seedRestaurant(
  organizationId: string,
  name: string,
  slug: string,
): Promise<{ restaurantId: string }> {
  const sql = testDb()
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO "menu"."restaurant" (id, organization_id, name, slug, default_language, supported_languages, updated_at)
    VALUES (
      gen_random_uuid()::text,
      ${organizationId},
      ${name},
      ${slug},
      'en',
      '["en"]'::jsonb,
      now()
    )
    RETURNING id
  `
  return { restaurantId: row!.id }
}
