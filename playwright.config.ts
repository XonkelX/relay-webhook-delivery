import { defineConfig, devices } from '@playwright/test'

const ownerBootstrapToken =
  process.env.RELAY_E2E_BOOTSTRAP_TOKEN ?? 'relay-e2e-bootstrap-token-0123456789abcdef'

const ownerSessionSigningKey =
  process.env.RELAY_E2E_SESSION_SIGNING_KEY ?? 'ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU='

const inheritedEnvironment: Record<string, string> = {}

for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    inheritedEnvironment[name] = value
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },

  webServer: {
    command:
      'npm run db:migrate:local && npm run db:seed:e2e && npm run dev --workspace=apps/console -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...inheritedEnvironment,
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
      OWNER_BOOTSTRAP_TOKEN: ownerBootstrapToken,
      OWNER_SESSION_SIGNING_KEY: ownerSessionSigningKey,
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
