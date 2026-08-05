import { expect, test } from '@playwright/test'

test('opens the landing page and enters the console', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Delivery infrastructure you can inspect.',
    }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Explore Relay' }).click()

  await expect(page).toHaveURL(/\/console$/)
  await expect(page.getByRole('heading', { name: 'Delivery control plane' })).toBeVisible()
})

test('navigates to an event and shows its delivery attempts', async ({ page }) => {
  await page.goto('/console/events')

  await page.getByRole('button', { name: /invoice\.payment_failed/ }).click()

  await expect(page).toHaveURL(/\/console\/events\/evt_/)
  await expect(page.getByRole('heading', { name: 'invoice.payment_failed' })).toBeVisible()

  await expect(page.getByText('Attempt 1')).toBeVisible()
  await expect(page.getByText('RequestTimeout')).toBeVisible()
  await expect(page.getByText('UpstreamUnavailable')).toBeVisible()
})

test('renders deterministic error and disabled states', async ({ page }) => {
  await page.goto('/console/events')

  await page.getByLabel('Preview state').selectOption('error')

  await expect(
    page.getByRole('heading', {
      name: 'Delivery activity is unavailable',
    }),
  ).toBeVisible()

  await page.goto('/console/endpoints')
  await page.getByLabel('Preview state').selectOption('disabled')

  await expect(page.getByRole('heading', { name: 'Endpoint is disabled' })).toBeVisible()
})

test('exposes keyboard navigation and the skip link', async ({ page }) => {
  await page.goto('/console')

  await page.keyboard.press('Tab')

  const skipLink = page.getByRole('link', { name: 'Skip to main content' })

  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()

  await skipLink.press('Enter')

  await expect(page.locator('#main-content')).toBeFocused()
})
