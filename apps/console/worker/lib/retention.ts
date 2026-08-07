import costGuardrails from '../../../../config/cost-guardrails.json' with { type: 'json' }
import type { RelayDatabase } from './database.js'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

const EVENT_BATCH_SIZE = costGuardrails.scheduler.maxClaimsPerTick

const ATTEMPT_BATCH_SIZE = EVENT_BATCH_SIZE * costGuardrails.delivery.maxAttempts

interface EventIdRow {
  id: string
}

export interface RetentionSweepResult {
  eventsDeleted: number
}

function retentionCutoff(now: string, retentionDays: number): string {
  const timestamp = Date.parse(now)

  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Retention sweep time must be a valid timestamp.')
  }

  return new Date(timestamp - retentionDays * MILLISECONDS_PER_DAY).toISOString()
}

export async function runRetentionSweep(
  database: RelayDatabase,
  now = new Date().toISOString(),
): Promise<RetentionSweepResult> {
  const eventCutoff = retentionCutoff(now, costGuardrails.retention.eventDays)

  const attemptCutoff = retentionCutoff(now, costGuardrails.retention.attemptDays)

  await database
    .prepare(
      `DELETE FROM delivery_attempts
       WHERE id IN (
         SELECT id
         FROM delivery_attempts
         WHERE state = 'completed'
           AND completed_at < ?
         ORDER BY completed_at ASC, id ASC
         LIMIT ?
       )`,
    )
    .bind(attemptCutoff, ATTEMPT_BATCH_SIZE)
    .run()

  const candidates = await database
    .prepare(
      `SELECT events.id
       FROM events
       WHERE events.created_at < ?
         AND NOT EXISTS (
           SELECT 1
           FROM deliveries
           WHERE deliveries.event_id = events.id
             AND deliveries.status NOT IN (
               'delivered',
               'exhausted',
               'cancelled'
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM deliveries AS source_delivery
           JOIN deliveries AS replay_delivery
             ON replay_delivery.replay_of_delivery_id =
                source_delivery.id
           WHERE source_delivery.event_id = events.id
             AND replay_delivery.event_id != events.id
         )
       ORDER BY
         events.created_at ASC,
         events.id ASC
       LIMIT ?`,
    )
    .bind(eventCutoff, EVENT_BATCH_SIZE)
    .all<EventIdRow>()

  const eventIds = candidates.results.map((event) => event.id)

  if (eventIds.length === 0) {
    return {
      eventsDeleted: 0,
    }
  }

  const placeholders = eventIds.map(() => '?').join(', ')

  await database.batch([
    database.prepare('PRAGMA defer_foreign_keys = ON'),

    database
      .prepare(
        `DELETE FROM delivery_attempts
         WHERE delivery_id IN (
           SELECT id
           FROM deliveries
           WHERE event_id IN (${placeholders})
         )`,
      )
      .bind(...eventIds),

    database
      .prepare(
        `DELETE FROM deliveries
         WHERE event_id IN (${placeholders})`,
      )
      .bind(...eventIds),

    database
      .prepare(
        `DELETE FROM events
         WHERE id IN (${placeholders})`,
      )
      .bind(...eventIds),
  ])

  return {
    eventsDeleted: eventIds.length,
  }
}
