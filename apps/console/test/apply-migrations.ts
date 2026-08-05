import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'

type TestMigrations = Parameters<typeof applyD1Migrations>[1]

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: TestMigrations
}

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
