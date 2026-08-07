import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ingestEvent } from '../worker/lib/ingest-event.js'

async function insertApiKey(id: string, prefix: string, hashCharacter: string) {
  await env.DB.prepare(
    `INSERT INTO api_keys (
         id,
         name,
         key_prefix,
         secret_hash,
         status,
         created_at
       )
       VALUES (?, ?, ?, ?, 'active', ?)`,
  )
    .bind(id, id, prefix, hashCharacter.repeat(64), '2026-08-07T05:00:00.000Z')
    .run()
}

function request(idempotencyKey: string) {
  return {
    event: {
      type: 'quota.test',
      data: {
        value: idempotencyKey,
      },
    },
    idempotencyKey,
    payloadJson: JSON.stringify({
      type: 'quota.test',
      data: {
        value: idempotencyKey,
      },
    }),
    payloadBytes: 64,
  } as const
}

describe('D1 ingestion quotas', () => {
  it('fails closed at the per-key daily quota', async () => {
    await env.DB.prepare(
      `UPDATE quota_limits
         SET per_key_daily_events = 1,
             global_daily_events = 10
         WHERE id = 1`,
    ).run()

    await insertApiKey('key_quota_per_key', 'rly_quota_key', 'a')

    const dependencies = {
      now: () => '2026-08-07T05:00:00.000Z',
    }

    await expect(
      ingestEvent(env.DB, 'key_quota_per_key', request('quota-key-1'), dependencies),
    ).resolves.toMatchObject({
      ok: true,
    })

    await expect(
      ingestEvent(env.DB, 'key_quota_per_key', request('quota-key-2'), dependencies),
    ).resolves.toEqual({
      ok: false,
      reason: 'quota_exceeded',
      scope: 'api_key',
    })

    const events = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM events
         WHERE api_key_id = ?`,
    )
      .bind('key_quota_per_key')
      .first<{ count: number }>()

    expect(events?.count).toBe(1)
  })

  it('fails closed at the global daily quota', async () => {
    await env.DB.prepare(
      `UPDATE quota_limits
         SET per_key_daily_events = 1,
             global_daily_events = 1
         WHERE id = 1`,
    ).run()

    await insertApiKey('key_quota_global_a', 'rly_quota_ga', 'b')

    await insertApiKey('key_quota_global_b', 'rly_quota_gb', 'c')

    const dependencies = {
      now: () => '2026-08-08T05:00:00.000Z',
    }

    await expect(
      ingestEvent(env.DB, 'key_quota_global_a', request('quota-global-1'), dependencies),
    ).resolves.toMatchObject({
      ok: true,
    })

    await expect(
      ingestEvent(env.DB, 'key_quota_global_b', request('quota-global-2'), dependencies),
    ).resolves.toEqual({
      ok: false,
      reason: 'quota_exceeded',
      scope: 'global',
    })

    const usage = await env.DB.prepare(
      `SELECT accepted_event_count
         FROM global_daily_usage
         WHERE usage_date = ?`,
    )
      .bind('2026-08-08')
      .first<{
        accepted_event_count: number
      }>()

    expect(usage?.accepted_event_count).toBe(1)
  })

  it('fails closed when quota configuration is missing', async () => {
    await env.DB.prepare(
      `DELETE FROM quota_limits
         WHERE id = 1`,
    ).run()

    await insertApiKey('key_quota_missing', 'rly_quota_missing', 'd')

    await expect(
      ingestEvent(env.DB, 'key_quota_missing', request('quota-missing'), {
        now: () => '2026-08-09T05:00:00.000Z',
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'quota_exceeded',
      scope: 'api_key',
    })
  })
})
