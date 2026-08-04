import { expect, test } from '@playwright/test'

test('loads the console and updates the counter', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Get started with Cloudflare' })).toBeVisible()

  await page.getByRole('button', { name: 'Count is 0' }).click()

  await expect(page.getByRole('button', { name: 'Count is 1' })).toBeVisible()
})
