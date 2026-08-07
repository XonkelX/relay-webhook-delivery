import costGuardrails from '../../../../config/cost-guardrails.json' with { type: 'json' }
import type { SystemHealthResponse } from '@relay/contracts'

export const operationalGuardrails: SystemHealthResponse['guardrails'] = {
  schedulerIntervalSeconds: costGuardrails.scheduler.intervalMinutes * 60,
  claimsPerTick: costGuardrails.scheduler.maxClaimsPerTick,
  maxDailyClaims: costGuardrails.scheduler.maxClaimsPerDay,
  maxDeliveryAttempts: costGuardrails.delivery.maxAttempts,
  requestTimeoutMs: costGuardrails.delivery.requestTimeoutMs,
  maxPayloadBytes: costGuardrails.delivery.maxPayloadBytes,
  maxResponseCaptureBytes: costGuardrails.delivery.maxResponseCaptureBytes,
  eventRetentionDays: costGuardrails.retention.eventDays,
  attemptRetentionDays: costGuardrails.retention.attemptDays,
}
