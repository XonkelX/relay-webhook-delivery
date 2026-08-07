import { expect, test, type Page } from '@playwright/test'

const ownerBootstrapToken =
  process.env.RELAY_E2E_BOOTSTRAP_TOKEN ?? 'relay-e2e-bootstrap-token-0123456789abcdef'

const routes = [
  '/',
  '/console',
  '/console/events',
  '/console/events/evt_e2econsole01',
  '/console/endpoints',
  '/console/failure-lab',
  '/console/health',
]

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
]

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

for (const viewport of viewports) {
  test(`routes avoid page overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    })

    await authenticateOwner(page)

    for (const route of routes) {
      await page.goto(route)

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))

      expect(
        dimensions.scrollWidth,
        `${route} overflowed at ${viewport.width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth)
    }
  })
}
