import { expect, test, type Page } from '@playwright/test'

const ownerBootstrapToken =
  process.env.RELAY_E2E_BOOTSTRAP_TOKEN ?? 'relay-e2e-bootstrap-token-0123456789abcdef'

async function authenticateOwner(page: Page) {
  await page.goto('/console')

  await expect(page.getByRole('heading', { name: 'Authenticate' })).toBeVisible()

  await page.getByLabel('Owner bootstrap token').fill(ownerBootstrapToken)
  await page.getByRole('button', { name: 'Open console' }).click()

  await expect(
    page.getByRole('heading', {
      name: 'Delivery control plane',
    }),
  ).toBeVisible()
}

test('opens the landing page, authenticates, and enters the console', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Delivery infrastructure you can inspect.',
    }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Explore Relay' }).click()

  await expect(page).toHaveURL(/\/console$/)
  await expect(page.getByRole('heading', { name: 'Authenticate' })).toBeVisible()

  await page.getByLabel('Owner bootstrap token').fill(ownerBootstrapToken)
  await page.getByRole('button', { name: 'Open console' }).click()

  await expect(
    page.getByRole('heading', {
      name: 'Delivery control plane',
    }),
  ).toBeVisible()
})

test('navigates to a persisted event and shows its delivery attempts', async ({ page }) => {
  await authenticateOwner(page)

  await page.goto('/console/events')

  await page
    .getByRole('link', {
      name: /invoice\.payment_failed/,
    })
    .click()

  await expect(page).toHaveURL(/\/console\/events\/evt_e2econsole01$/)

  await expect(
    page.getByRole('heading', {
      name: 'invoice.payment_failed',
    }),
  ).toBeVisible()

  await expect(page.getByText('Attempt 1')).toBeVisible()
  await expect(page.getByText('Attempt 2')).toBeVisible()
  await expect(page.getByText('Attempt 3')).toBeVisible()

  await expect(page.getByText('upstream unavailable')).toBeVisible()
  await expect(page.getByText('still unavailable')).toBeVisible()
  await expect(page.getByText('Webhook ID: msg_e2econsole01').first()).toBeVisible()
})

test('renders production endpoint and system health state', async ({ page }) => {
  await authenticateOwner(page)

  await page.goto('/console/endpoints')

  await expect(
    page.getByRole('heading', {
      name: 'Endpoints',
      exact: true,
    }),
  ).toBeVisible()

  await expect(
    page.getByRole('heading', {
      name: 'E2E Receiver',
    }),
  ).toBeVisible()

  await expect(
    page.getByRole('listitem').filter({ hasText: /^invoice\.payment_failed$/ }),
  ).toBeVisible()

  await page.goto('/console/health')

  await expect(
    page.getByRole('heading', {
      name: 'System health',
    }),
  ).toBeVisible()

  await expect(
    page.getByRole('heading', {
      name: 'Operational pressure',
    }),
  ).toBeVisible()

  await expect(
    page.getByRole('heading', {
      name: 'Operational guardrails',
    }),
  ).toBeVisible()
})

test('exposes keyboard navigation and the skip link', async ({ page }) => {
  await authenticateOwner(page)

  await page.goto('/console')
  await expect(page.getByRole('heading', { name: 'Delivery control plane' })).toBeVisible()

  await page.keyboard.press('Tab')

  const skipLink = page.getByRole('link', {
    name: 'Skip to main content',
  })

  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()

  await skipLink.press('Enter')

  await expect(page.locator('#main-content')).toBeFocused()
})
