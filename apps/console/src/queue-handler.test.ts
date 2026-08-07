import { describe, expect, it, vi } from 'vitest'
import type { RelayDatabase } from '../worker/lib/database.js'
import type { RelayWorkerEnvironment } from '../worker/middleware/require-api-key.js'
import { handleDeliveryQueue, type DeliveryQueueProcessor } from '../worker/queue-handler.js'

function createMessage(body: unknown) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function createEnvironment(): RelayWorkerEnvironment['Bindings'] {
  return {
    DB: {} as RelayDatabase,
    DELIVERY_QUEUE: {
      send: vi.fn(),
    },
    DELIVERY_SIGNING_SECRET: 'phase3_test_secret',
  }
}

describe('delivery Queue handler', () => {
  it('acks successfully completed work', async () => {
    const message = createMessage({
      version: 1,
      deliveryId: 'dlv_11111111111111111111111111111111',
      reason: 'initial',
    })

    const processDelivery = vi.fn().mockResolvedValue({
      action: 'ack',
      reason: 'completed',
      outcome: 'success',
    }) as DeliveryQueueProcessor

    await handleDeliveryQueue(
      {
        messages: [message],
      },
      createEnvironment(),
      {
        processDelivery,
      },
    )

    expect(message.ack).toHaveBeenCalledOnce()
    expect(message.retry).not.toHaveBeenCalled()
  })

  it('retries temporarily unavailable work', async () => {
    const message = createMessage({
      version: 1,
      deliveryId: 'dlv_22222222222222222222222222222222',
      reason: 'retry',
    })

    const processDelivery = vi.fn().mockResolvedValue({
      action: 'retry',
      reason: 'leased',
      delaySeconds: 7,
    }) as DeliveryQueueProcessor

    await handleDeliveryQueue(
      {
        messages: [message],
      },
      createEnvironment(),
      {
        processDelivery,
      },
    )

    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: 7,
    })
  })

  it('acks malformed poison messages', async () => {
    const message = createMessage({
      version: 1,
      deliveryId: 'invalid-id',
      reason: 'initial',
    })

    const processDelivery = vi.fn() as unknown as DeliveryQueueProcessor

    await handleDeliveryQueue(
      {
        messages: [message],
      },
      createEnvironment(),
      {
        processDelivery,
      },
    )

    expect(processDelivery).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalledOnce()
    expect(message.retry).not.toHaveBeenCalled()
  })

  it('retries unexpected processor failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const message = createMessage({
      version: 1,
      deliveryId: 'dlv_33333333333333333333333333333333',
      reason: 'initial',
    })

    const processDelivery = vi
      .fn()
      .mockRejectedValue(new Error('temporary database failure')) as DeliveryQueueProcessor

    await handleDeliveryQueue(
      {
        messages: [message],
      },
      createEnvironment(),
      {
        processDelivery,
      },
    )

    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: 30,
    })

    consoleError.mockRestore()
  })
})
