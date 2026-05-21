import { test, expect } from '../../fixtures'
import { seedRestaurant, truncateAll } from '../../helpers/db'

test.describe('QR Codes Admin Redesign E2E', () => {
  test.beforeEach(async () => {
    await truncateAll()
    // Seed a mock restaurant to associate QR codes to
    await seedRestaurant('o1', 'Sushi Express', 'sushi-express')
    await seedRestaurant('o1', 'Burger Joint', 'burger-joint')
  })

  test('should load the QR Codes Admin dashboard and verify visual redesign cards', async ({ signedInPage }) => {
    await signedInPage.goto('/dashboard/admin/qr-codes')

    // 1. Assert back links and heading
    await expect(signedInPage.locator('h1')).toContainText('QR codes (admin)')

    // 2. Assert that we have the two beautifully redesigned cards
    const singleCard = signedInPage.locator('div:has-text("Single QR Code")').first()
    await expect(singleCard).toBeVisible()
    await expect(singleCard.locator('text=Generate a single code')).toBeVisible()

    const bulkCard = signedInPage.locator('div:has-text("Bulk Generate")').first()
    await expect(bulkCard).toBeVisible()
    await expect(bulkCard.locator('text=Mint a batch of unbound stickers')).toBeVisible()
  })

  test('should create a single QR Code bound to a restaurant', async ({ signedInPage }) => {
    await signedInPage.goto('/dashboard/admin/qr-codes')

    // Locate Single QR Code card
    const singleCard = signedInPage.locator('div:has-text("Single QR Code")').first()

    // Fill in Custom Code
    await singleCard.locator('input[placeholder="e.g. table_10"]').fill('sticker_sushi_10')

    // Fill in Label
    await singleCard.locator('input[placeholder="e.g. Window table"]').fill('Sushi Table 10')

    // Select restaurant dropdown
    await singleCard.locator('select').selectOption({ label: 'Sushi Express' })

    // Click Create
    await singleCard.locator('button:has-text("Create QR Code")').click()

    // Verify row is added to the table
    const tableRow = signedInPage.locator('tr:has-text("sticker_sushi_10")')
    await expect(tableRow).toBeVisible()
    await expect(tableRow).toContainText('Sushi Table 10')
    await expect(tableRow).toContainText('Sushi Express')
  })

  test('should bulk generate a batch of unbound QR codes and copy list', async ({ signedInPage }) => {
    await signedInPage.goto('/dashboard/admin/qr-codes')

    const bulkCard = signedInPage.locator('div:has-text("Bulk Generate")').first()

    // Enter quantity
    await bulkCard.locator('input[type="number"]').fill('5')

    // Click Generate
    await bulkCard.locator('button:has-text("Generate Batch")').click()

    // Verify batch details code area is visible
    const copyBlock = signedInPage.locator('div:has-text("Copy List")').first()
    await expect(copyBlock).toBeVisible()

    // Verify we have 5 generated codes listed in the code container
    const codeListText = await copyBlock.locator('pre').innerText()
    const codes = codeListText.trim().split('\n')
    expect(codes.length).toBe(5)
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9_-]{8}$/)
    }
  })

  test('should allow changing a QR code association inline in the table', async ({ signedInPage }) => {
    await signedInPage.goto('/dashboard/admin/qr-codes')

    // 1. Create a single unbound QR code first
    const singleCard = signedInPage.locator('div:has-text("Single QR Code")').first()
    await singleCard.locator('input[placeholder="e.g. table_10"]').fill('inline_sticker')
    await singleCard.locator('input[placeholder="e.g. Window table"]').fill('Inline Table')
    await singleCard.locator('button:has-text("Create QR Code")').click()

    // Verify the unbound row exists
    const tableRow = signedInPage.locator('tr:has-text("inline_sticker")')
    await expect(tableRow).toBeVisible()
    await expect(tableRow.locator('select')).toHaveValue('') // Should start unbound

    // 2. Select Burger Joint inline
    await tableRow.locator('select').selectOption({ label: 'Burger Joint' })

    // Wait for auto-save transition or refresh to verify
    await signedInPage.reload()

    const updatedRow = signedInPage.locator('tr:has-text("inline_sticker")')
    await expect(updatedRow.locator('select')).toHaveValue('burger-joint')
  })
})
