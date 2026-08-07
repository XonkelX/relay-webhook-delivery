import { env } from 'cloudflare:workers'
import { OverviewResponseSchema, SystemHealthResponseSchema } from '@relay/contracts'
import { describe, expect, it, vi } from 'vitest'
import app from '../worker/index.js'
import { createSignedOwnerSessionCookieValue } from '../worker/lib/owner-session-http.js'
import { createOwnerSession } from '../worker/lib/owner-session.js'

const signingKey = btoa('h'.repeat(32))

async function ownerCookie() {
  const rawToken = `rly_owner_${'overviewhealth'.padEnd(64, 'h')}`

  await createOwnerSession(env.DB, 3600, {
    createId: () => 'ses_overviewhealth',
    createToken: () => rawToken,
  })

  const signed = await createSignedOwnerSessionCookieValue(rawToken, signingKey)

  return `__Host-relay_owner=${signed}`
}

function requestOwner(path: '/api/owner/overview' | '/api/owner/health', cookie: string) {
  return app.request(
    path,
    {
      headers: {
        Cookie: cookie,
      },
    },
    {
      DB: env.DB,
      DELIVERY_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      OWNER_SESSION_SIGNING_KEY: signingKey,
    },
  )
}

describe('owner operational summaries', () => {
  it('reports real overview, health, quota, median, and due-outbox state', async () => {
    const cookie = await ownerCookie()
    const now = new Date()

    const at = (minutesAgo: number) =>
      new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString()

    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString()

    const usageDate = now.toISOString().slice(0, 10)

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_keys (
             id,
             name,
             key_prefix,
             secret_hash,
             status,
             created_at
           )
           VALUES (
             'key_healthoverview',
             'Health overview',
             'rly_health1',
             ?,
             'active',
             ?
           )`,
      ).bind('8'.repeat(64), at(240)),

      env.DB.prepare(
        `INSERT INTO endpoints (
             id,
             name,
             url,
             status,
             created_at,
             updated_at,
             verified_at
           )
           VALUES
             (
               'ep_healthactive',
               'Primary',
               'https://health-active.example.test/webhook',
               'active',
               ?,
               ?,
               ?
             ),
             (
               'ep_healthpaused',
               'Paused',
               'https://health-paused.example.test/webhook',
               'paused',
               ?,
               ?,
               NULL
             )`,
      ).bind(at(240), at(30), at(240), at(240), at(30)),

      env.DB.prepare(
        `INSERT INTO events (
             id,
             api_key_id,
             idempotency_key,
             event_type,
             payload_json,
             payload_sha256,
             payload_bytes,
             created_at
           )
           VALUES
             (
               'evt_healthdelivered',
               'key_healthoverview',
               'health-delivered',
               'health.delivered',
               '{}',
               ?,
               2,
               ?
             ),
             (
               'evt_healthexhausted',
               'key_healthoverview',
               'health-exhausted',
               'health.exhausted',
               '{}',
               ?,
               2,
               ?
             ),
             (
               'evt_healthretrying',
               'key_healthoverview',
               'health-retrying',
               'health.retrying',
               '{}',
               ?,
               2,
               ?
             ),
             (
               'evt_healthqueued',
               'key_healthoverview',
               'health-queued',
               'health.queued',
               '{}',
               ?,
               2,
               ?
             ),
             (
               'evt_healthfuture',
               'key_healthoverview',
               'health-future',
               'health.future',
               '{}',
               ?,
               2,
               ?
             )`,
      ).bind(
        '1'.repeat(64),
        at(180),
        '2'.repeat(64),
        at(120),
        '3'.repeat(64),
        at(90),
        '4'.repeat(64),
        at(60),
        '5'.repeat(64),
        at(30),
      ),

      env.DB.prepare(
        `INSERT INTO deliveries (
             id,
             event_id,
             endpoint_id,
             status,
             attempt_count,
             next_attempt_at,
             created_at,
             updated_at,
             delivered_at,
             exhausted_at
           )
           VALUES
             (
               'dlv_healthdelivered',
               'evt_healthdelivered',
               'ep_healthactive',
               'delivered',
               1,
               ?,
               ?,
               ?,
               ?,
               NULL
             ),
             (
               'dlv_healthexhausted',
               'evt_healthexhausted',
               'ep_healthactive',
               'exhausted',
               1,
               ?,
               ?,
               ?,
               NULL,
               ?
             ),
             (
               'dlv_healthretrying',
               'evt_healthretrying',
               'ep_healthactive',
               'retrying',
               2,
               ?,
               ?,
               ?,
               NULL,
               NULL
             ),
             (
               'dlv_healthqueued',
               'evt_healthqueued',
               'ep_healthactive',
               'queued',
               0,
               ?,
               ?,
               ?,
               NULL,
               NULL
             ),
             (
               'dlv_healthfuture',
               'evt_healthfuture',
               'ep_healthactive',
               'queued',
               0,
               ?,
               ?,
               ?,
               NULL,
               NULL
             )`,
      ).bind(
        at(180),
        at(180),
        at(180),
        at(180),
        at(120),
        at(120),
        at(120),
        at(120),
        at(10),
        at(90),
        at(10),
        at(5),
        at(60),
        at(5),
        future,
        at(30),
        at(30),
      ),

      env.DB.prepare(
        `INSERT INTO delivery_attempts (
             id,
             delivery_id,
             attempt_no,
             state,
             outcome,
             request_started_at,
             completed_at,
             status_code,
             latency_ms,
             error_class,
             created_at
           )
           VALUES
             (
               'att_health1',
               'dlv_healthdelivered',
               1,
               'completed',
               'success',
               ?,
               ?,
               200,
               100,
               NULL,
               ?
             ),
             (
               'att_health2',
               'dlv_healthexhausted',
               1,
               'completed',
               'permanent_failure',
               ?,
               ?,
               400,
               200,
               'http_400',
               ?
             ),
             (
               'att_health3',
               'dlv_healthretrying',
               1,
               'completed',
               'transient_failure',
               ?,
               ?,
               503,
               300,
               'http_503',
               ?
             ),
             (
               'att_health4',
               'dlv_healthretrying',
               2,
               'completed',
               'transient_failure',
               ?,
               ?,
               503,
               900,
               'http_503',
               ?
             )`,
      ).bind(
        at(180),
        at(179),
        at(180),
        at(120),
        at(119),
        at(120),
        at(90),
        at(89),
        at(90),
        at(60),
        at(59),
        at(60),
      ),

      env.DB.prepare(
        `INSERT INTO delivery_outbox (
             id,
             delivery_id,
             available_at,
             published_at,
             reason,
             created_at
           )
           VALUES
             (
               'out_healthdue',
               'dlv_healthqueued',
               ?,
               NULL,
               'initial',
               ?
             ),
             (
               'out_healthfuture',
               'dlv_healthfuture',
               ?,
               NULL,
               'initial',
               ?
             )`,
      ).bind(at(5), at(60), future, at(30)),

      env.DB.prepare(
        `INSERT INTO global_daily_usage (
             usage_date,
             accepted_event_count,
             generated_delivery_count,
             payload_bytes,
             updated_at
           )
           VALUES (?, 321, 5, 10, ?)
           ON CONFLICT (usage_date)
           DO UPDATE SET
             accepted_event_count = 321,
             generated_delivery_count = 5,
             payload_bytes = 10,
             updated_at = excluded.updated_at`,
      ).bind(usageDate, now.toISOString()),
    ])

    const overviewResponse = await requestOwner('/api/owner/overview', cookie)

    expect(overviewResponse.status).toBe(200)

    const overview = OverviewResponseSchema.parse(await overviewResponse.json())

    expect(overview).toMatchObject({
      events24h: 5,
      deliveries24h: 5,
      delivered24h: 1,
      retryingNow: 1,
      exhausted24h: 1,
      successRate24h: 50,
      medianLatencyMs24h: 250,
      endpointCount: 2,
      activeEndpointCount: 1,
    })

    expect(overview.oldestRetryAt).toBe(at(10))
    expect(overview.recentEvents).toHaveLength(5)

    const healthResponse = await requestOwner('/api/owner/health', cookie)

    expect(healthResponse.status).toBe(200)

    const health = SystemHealthResponseSchema.parse(await healthResponse.json())

    expect(health).toMatchObject({
      queuedDeliveries: 2,
      retryingDeliveries: 1,
      pendingOutbox: 1,
      successRate24h: 50,
      medianLatencyMs24h: 250,
      quotas: {
        perKeyDailyEventLimit: 1000,
        globalDailyEventLimit: 5000,
        globalAcceptedEventsToday: 321,
      },
      guardrails: {
        schedulerIntervalSeconds: 60,
        claimsPerTick: 25,
        maxDailyClaims: 50000,
        maxDeliveryAttempts: 8,
        requestTimeoutMs: 10000,
        maxPayloadBytes: 262144,
        maxResponseCaptureBytes: 16384,
        eventRetentionDays: 30,
        attemptRetentionDays: 30,
      },
    })

    expect(health.oldestQueuedAt).toBe(at(60))
    expect(health.oldestRetryAt).toBe(at(10))
    expect(health.oldestPendingOutboxAt).toBe(at(5))
  })
})
