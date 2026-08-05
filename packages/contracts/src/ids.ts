import { z } from 'zod'

function prefixedId(prefix: string) {
  return z
    .string()
    .max(80)
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9]+$`),
      `Expected an identifier beginning with ${prefix}_`,
    )
}

export const ApiKeyIdSchema = prefixedId('key')
export const SessionIdSchema = prefixedId('ses')
export const EndpointIdSchema = prefixedId('ep')
export const EventIdSchema = prefixedId('evt')
export const DeliveryIdSchema = prefixedId('dlv')
export const AttemptIdSchema = prefixedId('att')
export const OutboxIdSchema = prefixedId('out')
export const AuditIdSchema = prefixedId('aud')

export type ApiKeyId = z.infer<typeof ApiKeyIdSchema>
export type SessionId = z.infer<typeof SessionIdSchema>
export type EndpointId = z.infer<typeof EndpointIdSchema>
export type EventId = z.infer<typeof EventIdSchema>
export type DeliveryId = z.infer<typeof DeliveryIdSchema>
export type AttemptId = z.infer<typeof AttemptIdSchema>
export type OutboxId = z.infer<typeof OutboxIdSchema>
export type AuditId = z.infer<typeof AuditIdSchema>
