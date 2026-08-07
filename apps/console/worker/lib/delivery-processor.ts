import type { AttemptOutcome, DeliveryQueueMessage } from '@relay/contracts'
import { completeDeliveryAttempt, startDeliveryAttempt } from './delivery-attempt.js'
import { claimDelivery, type ClaimDeliveryResult } from './delivery-claim.js'
import { loadDeliveryContext } from './delivery-context.js'
import { calculateBackoffDelay, decideHttpRetry } from './delivery-policy.js'
import type { RelayDatabase } from './database.js'
import type { RelayIdPrefix } from './ids.js'
import { executeWebhook } from './webhook-executor.js'
import { buildWebhookRequest, createWebhookId } from './webhook-request.js'

const REQUEUE_DELAY_SECONDS = 5

export interface DeliveryProcessorDependencies {
  resolveSigningSecrets(endpointId: string): Promise<string[]>

  fetcher?: typeof fetch
  nowMilliseconds?: () => number
  random?: () => number
  createLeaseToken?: () => string
  createAttemptId?: (prefix: RelayIdPrefix) => string
  leaseSeconds?: number
  timeoutMs?: number
  maxAttempts?: number
}

export type ProcessDeliveryResult =
  | {
      action: 'ack'
      reason: 'completed' | 'missing' | 'terminal'
      outcome?: AttemptOutcome
    }
  | {
      action: 'retry'
      reason: 'leased' | 'scheduled' | 'contended' | 'lease_lost' | 'context_missing'
      delaySeconds: number
    }

function toIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

function handleClaimFailure(
  claim: Extract<ClaimDeliveryResult, { ok: false }>,
): ProcessDeliveryResult {
  if (claim.reason === 'missing' || claim.reason === 'terminal') {
    return {
      action: 'ack',
      reason: claim.reason,
    }
  }

  return {
    action: 'retry',
    reason: claim.reason,
    delaySeconds: REQUEUE_DELAY_SECONDS,
  }
}

export async function processDeliveryMessage(
  database: RelayDatabase,
  message: DeliveryQueueMessage,
  dependencies: DeliveryProcessorDependencies,
): Promise<ProcessDeliveryResult> {
  const nowMilliseconds = dependencies.nowMilliseconds ?? Date.now

  const claimedAtMilliseconds = nowMilliseconds()
  const claimedAt = toIso(claimedAtMilliseconds)

  const claim = await claimDelivery(database, message.deliveryId, dependencies.leaseSeconds, {
    now: () => claimedAt,
    ...(dependencies.createLeaseToken
      ? {
          createLeaseToken: dependencies.createLeaseToken,
        }
      : {}),
  })

  if (!claim.ok) {
    return handleClaimFailure(claim)
  }

  const context = await loadDeliveryContext(database, claim.value.id)

  if (!context) {
    return {
      action: 'retry',
      reason: 'context_missing',
      delaySeconds: REQUEUE_DELAY_SECONDS,
    }
  }

  const signingSecrets = await dependencies.resolveSigningSecrets(context.endpointId)

  const requestStartedMilliseconds = nowMilliseconds()
  const requestStartedAt = toIso(requestStartedMilliseconds)
  const webhookId = createWebhookId(claim.value.id)

  const attempt = await startDeliveryAttempt(
    database,
    {
      deliveryId: claim.value.id,
      attemptNo: claim.value.attemptNo,
      leaseToken: claim.value.leaseToken,
      webhookId,
      requestStartedAt,
    },
    dependencies.createAttemptId
      ? {
          createId: dependencies.createAttemptId,
        }
      : {},
  )

  if (!attempt) {
    return {
      action: 'retry',
      reason: 'lease_lost',
      delaySeconds: REQUEUE_DELAY_SECONDS,
    }
  }

  const built = await buildWebhookRequest({
    deliveryId: context.deliveryId,
    endpointUrl: context.endpointUrl,
    event: {
      id: context.eventId,
      type: context.eventType,
      timestamp: context.eventCreatedAt,
      data: context.eventData,
    },
    signingSecrets,
    timestampSeconds: Math.floor(requestStartedMilliseconds / 1000),
  })

  const execution = await executeWebhook(
    {
      request: built.request,
      ...(dependencies.timeoutMs ? { timeoutMs: dependencies.timeoutMs } : {}),
    },
    {
      ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
      nowMilliseconds,
    },
  )

  const completedMilliseconds = nowMilliseconds()
  const completedAt = toIso(completedMilliseconds)

  let outcome: AttemptOutcome
  let retryAt: string | null = null
  let statusCode: number | null = null
  let latencyMs: number
  let errorClass: string | null = null
  let responseHeaders: Record<string, string> | null = null
  let responseExcerpt: string | null = null

  if (execution.kind === 'response') {
    const decision = decideHttpRetry(execution.statusCode, claim.value.attemptNo, {
      retryAfter: execution.retryAfter,
      nowMilliseconds: completedMilliseconds,
      ...(dependencies.random ? { random: dependencies.random } : {}),
    })

    outcome = decision.outcome
    statusCode = execution.statusCode
    latencyMs = execution.latencyMs
    responseHeaders = execution.responseHeaders
    responseExcerpt = execution.responseExcerpt

    if (outcome !== 'success') {
      errorClass = `http_${execution.statusCode}`
    }

    if (decision.delaySeconds !== null) {
      retryAt = toIso(completedMilliseconds + decision.delaySeconds * 1000)
    }
  } else {
    outcome = execution.kind === 'timeout' ? 'timeout' : 'network_error'

    latencyMs = execution.latencyMs
    errorClass = execution.errorClass

    const delaySeconds = calculateBackoffDelay(
      claim.value.attemptNo,
      dependencies.random ? { random: dependencies.random } : {},
    )

    retryAt = toIso(completedMilliseconds + delaySeconds * 1000)
  }

  const completed = await completeDeliveryAttempt(database, {
    deliveryId: claim.value.id,
    attemptNo: claim.value.attemptNo,
    leaseToken: claim.value.leaseToken,
    outcome,
    completedAt,
    retryAt,
    statusCode,
    latencyMs,
    errorClass,
    responseHeaders,
    responseExcerpt,
    ...(dependencies.maxAttempts ? { maxAttempts: dependencies.maxAttempts } : {}),
  })

  if (!completed) {
    return {
      action: 'retry',
      reason: 'lease_lost',
      delaySeconds: REQUEUE_DELAY_SECONDS,
    }
  }

  return {
    action: 'ack',
    reason: 'completed',
    outcome,
  }
}
