import { expect, test } from '@playwright/test'

const routes = [
  '/',
  '/console',
  '/console/events',
  '/console/events/evt_01J4M91QX3F7D8A2S6N5K0V4BC',
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

for (const viewport of viewports) {
  test(`routes avoid page overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    })

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
