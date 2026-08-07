import { DeliveryQueueMessageSchema } from '@relay/contracts'
import type { RelayDatabase } from './lib/database.js'
import {
  processDeliveryMessage,
  type DeliveryProcessorDependencies,
  type ProcessDeliveryResult,
} from './lib/delivery-processor.js'
import type { RelayWorkerEnvironment } from './middleware/require-api-key.js'

export interface QueueMessageLike {
  body: unknown
  ack(): void
  retry(options: { delaySeconds: number }): void
}

export interface QueueBatchLike {
  messages: readonly QueueMessageLike[]
}

export type DeliveryQueueProcessor = (
  database: RelayDatabase,
  message: Parameters<typeof processDeliveryMessage>[1],
  dependencies: DeliveryProcessorDependencies,
) => Promise<ProcessDeliveryResult>

export interface QueueHandlerDependencies {
  processDelivery?: DeliveryQueueProcessor
}

export async function handleDeliveryQueue(
  batch: QueueBatchLike,
  env: RelayWorkerEnvironment['Bindings'],
  dependencies: QueueHandlerDependencies = {},
): Promise<void> {
  const processDelivery = dependencies.processDelivery ?? processDeliveryMessage

  await Promise.all(
    batch.messages.map(async (message) => {
      const parsed = DeliveryQueueMessageSchema.safeParse(message.body)

      if (!parsed.success) {
        console.warn('Discarding invalid delivery queue message')
        message.ack()
        return
      }

      try {
        const result = await processDelivery(env.DB, parsed.data, {
          resolveSigningSecret: async (endpointId) => {
            void endpointId

            if (!env.DELIVERY_SIGNING_SECRET) {
              throw new Error('DELIVERY_SIGNING_SECRET is not configured.')
            }

            return env.DELIVERY_SIGNING_SECRET
          },
        })

        if (result.action === 'ack') {
          message.ack()
          return
        }

        message.retry({
          delaySeconds: result.delaySeconds,
        })
      } catch (error) {
        console.error('Queue delivery processing failed', error)

        message.retry({
          delaySeconds: 30,
        })
      }
    }),
  )
}
