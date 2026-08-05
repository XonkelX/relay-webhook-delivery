export type DeliveryStatus = 'queued' | 'delivered' | 'retrying' | 'exhausted' | 'replayed'

export type AttemptOutcome = 'success' | 'transient_failure' | 'permanent_failure' | 'timeout'

export interface AttemptFixture {
  id: string
  number: number
  occurredAt: string
  latencyMs: number
  statusCode: number | null
  outcome: AttemptOutcome
  errorClass?: string
}

export interface EventFixture {
  id: string
  deliveryId: string
  webhookId: string
  eventType: string
  endpointName: string
  endpointUrl: string
  createdAt: string
  status: DeliveryStatus
  attemptCount: number
  nextRetryAt?: string
  replayOf?: string
  attempts: AttemptFixture[]
}
