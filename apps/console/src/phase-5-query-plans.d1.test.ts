import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

interface QueryPlanRow {
  detail: string
}

async function explain(query: string, bindings: unknown[] = []): Promise<string> {
  const statement = env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...bindings)

  const result = await statement.all<QueryPlanRow>()

  return result.results.map((row) => row.detail).join('\n')
}

describe('Phase 5 query plans', () => {
  it('uses the event type cursor index', async () => {
    const plan = await explain(
      `SELECT id
       FROM events
       WHERE event_type = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      ['orders.created'],
    )

    expect(plan).toContain('idx_events_type_created_cursor')
  })

  it('uses the delivery status/event index', async () => {
    const plan = await explain(
      `SELECT event_id
       FROM deliveries
       WHERE status = ?
         AND event_id = ?`,
      ['retrying', 'evt_query_plan'],
    )

    expect(plan).toContain('idx_deliveries_status_event')
  })

  it('uses the endpoint delivery cursor index', async () => {
    const plan = await explain(
      `SELECT id
       FROM deliveries
       WHERE endpoint_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      ['ep_query_plan'],
    )

    expect(plan).toContain('idx_deliveries_endpoint_created')
  })

  it('uses the completed-attempt index', async () => {
    const plan = await explain(
      `SELECT id
       FROM delivery_attempts
       WHERE state = 'completed'
         AND completed_at < ?
       ORDER BY completed_at ASC, id ASC
       LIMIT 200`,
      ['2026-07-01T00:00:00.000Z'],
    )

    expect(plan).toContain('idx_delivery_attempts_completed')
  })

  it('uses the replay-source index', async () => {
    const plan = await explain(
      `SELECT id
       FROM deliveries
       WHERE replay_of_delivery_id = ?
       LIMIT 1`,
      ['dlv_query_plan'],
    )

    expect(plan).toContain('idx_deliveries_replay_source')
  })
})
