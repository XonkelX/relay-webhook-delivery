import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { replayDelivery } from '../worker/lib/replay-delivery.js'
import { runRetentionSweep } from '../worker/lib/retention.js'

const now = '2026-08-07T12:00:00.000Z'
const old = '2026-06-20T12:00:00.000Z'
const oldAttempt = '2026-06-25T12:00:00.000Z'
const recent = '2026-08-01T12:00:00.000Z'

describe('D1 retention sweep', () => {
  it('prunes expired evidence without deleting active or recent work', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
           id, name, key_prefix, secret_hash,
           status, created_at
         )
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_retention', 'Retention test', 'rly_retention', 'a'.repeat(64), old),

      env.DB.prepare(
        `INSERT INTO endpoints (
           id, name, url, status,
           created_at, updated_at, verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind('ep_retention', 'Retention endpoint', 'https://example.test/retention', old, old, old),

      env.DB.prepare(
        `INSERT INTO events (
           id, api_key_id, idempotency_key,
           event_type, payload_json,
           payload_sha256, payload_bytes,
           created_at
         )
         VALUES (?, ?, ?, ?, '{}', ?, 2, ?)`,
      ).bind(
        'evt_retention_terminal',
        'key_retention',
        'retention-terminal',
        'retention.terminal',
        'b'.repeat(64),
        old,
      ),

      env.DB.prepare(
        `INSERT INTO events (
           id, api_key_id, idempotency_key,
           event_type, payload_json,
           payload_sha256, payload_bytes,
           created_at
         )
         VALUES (?, ?, ?, ?, '{}', ?, 2, ?)`,
      ).bind(
        'evt_retention_active',
        'key_retention',
        'retention-active',
        'retention.active',
        'c'.repeat(64),
        old,
      ),

      env.DB.prepare(
        `INSERT INTO events (
           id, api_key_id, idempotency_key,
           event_type, payload_json,
           payload_sha256, payload_bytes,
           created_at
         )
         VALUES (?, ?, ?, ?, '{}', ?, 2, ?)`,
      ).bind(
        'evt_retention_recent',
        'key_retention',
        'retention-recent',
        'retention.recent',
        'd'.repeat(64),
        recent,
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count,
           next_attempt_at,
           created_at, updated_at,
           delivered_at
         )
         VALUES (?, ?, ?, 'delivered', 1, ?, ?, ?, ?)`,
      ).bind('dlv_retention_source', 'evt_retention_terminal', 'ep_retention', old, old, old, old),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count,
           next_attempt_at,
           replay_of_delivery_id,
           created_at, updated_at,
           delivered_at
         )
         VALUES (?, ?, ?, 'delivered', 1, ?, ?, ?, ?, ?)`,
      ).bind(
        'dlv_retention_replay',
        'evt_retention_terminal',
        'ep_retention',
        old,
        'dlv_retention_source',
        old,
        old,
        old,
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count,
           next_attempt_at,
           created_at, updated_at
         )
         VALUES (?, ?, ?, 'retrying', 2, ?, ?, ?)`,
      ).bind('dlv_retention_active', 'evt_retention_active', 'ep_retention', now, old, now),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count,
           next_attempt_at,
           created_at, updated_at,
           delivered_at
         )
         VALUES (?, ?, ?, 'delivered', 1, ?, ?, ?, ?)`,
      ).bind(
        'dlv_retention_recent',
        'evt_retention_recent',
        'ep_retention',
        recent,
        recent,
        recent,
        recent,
      ),

      env.DB.prepare(
        `INSERT INTO delivery_outbox (
           id, delivery_id, available_at,
           published_at, publish_attempts,
           reason, created_at
         )
         VALUES (?, ?, ?, ?, 1, 'replay', ?)`,
      ).bind('out_retention_replay', 'dlv_retention_replay', old, old, old),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           created_at
         )
         VALUES (?, ?, 1, 'completed', 'success', ?, ?, 204, 10, ?)`,
      ).bind('att_retention_source', 'dlv_retention_source', oldAttempt, oldAttempt, oldAttempt),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           created_at
         )
         VALUES (?, ?, 1, 'completed', 'success', ?, ?, 204, 12, ?)`,
      ).bind('att_retention_replay', 'dlv_retention_replay', oldAttempt, oldAttempt, oldAttempt),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           created_at
         )
         VALUES (?, ?, 1, 'completed', 'transient_failure', ?, ?, 503, 20, ?)`,
      ).bind(
        'att_retention_active_old',
        'dlv_retention_active',
        oldAttempt,
        oldAttempt,
        oldAttempt,
      ),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state,
           request_started_at,
           created_at
         )
         VALUES (?, ?, 2, 'started', ?, ?)`,
      ).bind('att_retention_active_started', 'dlv_retention_active', recent, recent),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
           id, delivery_id, attempt_no,
           state, outcome,
           request_started_at, completed_at,
           status_code, latency_ms,
           created_at
         )
         VALUES (?, ?, 1, 'completed', 'success', ?, ?, 204, 15, ?)`,
      ).bind('att_retention_recent', 'dlv_retention_recent', recent, recent, recent),
    ])

    await expect(runRetentionSweep(env.DB, now)).resolves.toEqual({
      eventsDeleted: 1,
    })

    const events = await env.DB.prepare(
      `SELECT id
       FROM events
       WHERE id LIKE 'evt_retention_%'
       ORDER BY id`,
    ).all<{ id: string }>()

    expect(events.results.map((row) => row.id)).toEqual([
      'evt_retention_active',
      'evt_retention_recent',
    ])

    const deliveries = await env.DB.prepare(
      `SELECT id
       FROM deliveries
       WHERE id LIKE 'dlv_retention_%'
       ORDER BY id`,
    ).all<{ id: string }>()

    expect(deliveries.results.map((row) => row.id)).toEqual([
      'dlv_retention_active',
      'dlv_retention_recent',
    ])

    const attempts = await env.DB.prepare(
      `SELECT id
       FROM delivery_attempts
       WHERE id LIKE 'att_retention_%'
       ORDER BY id`,
    ).all<{ id: string }>()

    expect(attempts.results.map((row) => row.id)).toEqual([
      'att_retention_active_started',
      'att_retention_recent',
    ])

    const outbox = await env.DB.prepare(
      `SELECT id
       FROM delivery_outbox
       WHERE id = 'out_retention_replay'`,
    ).first<{ id: string }>()

    expect(outbox).toBeNull()

    const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_check').all()

    expect(foreignKeys.results).toEqual([])
  })
  it('preserves an expired event when a replay is queued after candidate selection', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
           id, name, key_prefix, secret_hash,
           status, created_at
         )
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind('key_retention_race', 'Retention race', 'rly_ret_race', 'e'.repeat(64), old),

      env.DB.prepare(
        `INSERT INTO endpoints (
           id, name, url, status,
           created_at, updated_at, verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_retention_race',
        'Retention race endpoint',
        'https://example.test/retention-race',
        old,
        old,
        old,
      ),

      env.DB.prepare(
        `INSERT INTO events (
           id, api_key_id, idempotency_key,
           event_type, payload_json,
           payload_sha256, payload_bytes,
           created_at
         )
         VALUES (?, ?, ?, ?, '{}', ?, 2, ?)`,
      ).bind(
        'evt_retention_race',
        'key_retention_race',
        'retention-race',
        'retention.race',
        'f'.repeat(64),
        old,
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
           id, event_id, endpoint_id,
           status, attempt_count,
           next_attempt_at,
           created_at, updated_at,
           delivered_at
         )
         VALUES (?, ?, ?, 'delivered', 1, ?, ?, ?, ?)`,
      ).bind(
        'dlv_retention_race_source',
        'evt_retention_race',
        'ep_retention_race',
        old,
        old,
        old,
        old,
      ),
    ])

    const result = await runRetentionSweep(env.DB, now, {
      afterCandidateSelection: async (eventIds) => {
        expect(eventIds).toContain('evt_retention_race')

        const replayIds: Record<string, string> = {
          dlv: 'dlv_retention_race_replay',
          out: 'out_retention_race_replay',
          aud: 'aud_retention_race_replay',
        }

        const replay = await replayDelivery(env.DB, 'dlv_retention_race_source', {
          now: () => '2026-08-07T12:00:01.000Z',
          createId: (prefix) => replayIds[prefix]!,
        })

        expect(replay.ok).toBe(true)
      },
    })

    expect(result).toEqual({
      eventsDeleted: 0,
    })

    const event = await env.DB.prepare(
      `SELECT id
         FROM events
         WHERE id = 'evt_retention_race'`,
    ).first<{ id: string }>()

    expect(event?.id).toBe('evt_retention_race')

    const deliveries = await env.DB.prepare(
      `SELECT id, status
         FROM deliveries
         WHERE event_id = 'evt_retention_race'
         ORDER BY id`,
    ).all<{ id: string; status: string }>()

    expect(deliveries.results).toEqual([
      {
        id: 'dlv_retention_race_replay',
        status: 'queued',
      },
      {
        id: 'dlv_retention_race_source',
        status: 'delivered',
      },
    ])

    const outbox = await env.DB.prepare(
      `SELECT id
         FROM delivery_outbox
         WHERE id = 'out_retention_race_replay'`,
    ).first<{ id: string }>()

    expect(outbox?.id).toBe('out_retention_race_replay')

    const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_check').all()

    expect(foreignKeys.results).toEqual([])
  })
})
