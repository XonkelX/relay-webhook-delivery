import { describe, expect, it, vi } from 'vitest'
import { executeWebhook } from '../worker/lib/webhook-executor.js'

function clock(values: number[]): () => number {
  return () => {
    const value = values.shift()

    if (value === undefined) {
      throw new Error('Test clock exhausted.')
    }

    return value
  }
}

describe('webhook executor', () => {
  it('captures response evidence', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('accepted', {
          status: 202,
          headers: {
            'retry-after': '30',
            'x-request-id': 'req_123',
          },
        }),
    ) as typeof fetch

    const result = await executeWebhook(
      {
        request: new Request('https://example.test/hook', {
          method: 'POST',
          body: '{}',
        }),
      },
      {
        fetcher,
        nowMilliseconds: clock([1000, 1125]),
      },
    )

    expect(result).toMatchObject({
      kind: 'response',
      statusCode: 202,
      latencyMs: 125,
      responseExcerpt: 'accepted',
      retryAfter: '30',
    })
  })

  it('bounds response excerpts', async () => {
    const result = await executeWebhook(
      {
        request: new Request('https://example.test/hook'),
      },
      {
        fetcher: vi.fn(
          async () =>
            new Response('x'.repeat(10_000), {
              status: 500,
            }),
        ) as typeof fetch,
        nowMilliseconds: clock([0, 10]),
      },
    )

    expect(result.kind).toBe('response')

    if (result.kind === 'response') {
      expect(result.responseExcerpt).toHaveLength(2000)
    }
  })

  it('classifies network failures', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('connection refused')
    }) as typeof fetch

    await expect(
      executeWebhook(
        {
          request: new Request('https://example.test/hook'),
        },
        {
          fetcher,
          nowMilliseconds: clock([3000, 3012]),
        },
      ),
    ).resolves.toEqual({
      kind: 'network_error',
      latencyMs: 12,
      errorClass: 'TypeError',
    })
  })

  it('classifies an aborted request as timeout', async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    ) as typeof fetch

    await expect(
      executeWebhook(
        {
          request: new Request('https://example.test/hook'),
          timeoutMs: 5,
        },
        {
          fetcher,
          nowMilliseconds: clock([2000, 2005]),
        },
      ),
    ).resolves.toEqual({
      kind: 'timeout',
      latencyMs: 5,
      errorClass: 'timeout',
    })
  })

  it.each([0, -1, 1.5, 60_001])('rejects invalid timeout %s', async (timeoutMs) => {
    await expect(
      executeWebhook({
        request: new Request('https://example.test/hook'),
        timeoutMs,
      }),
    ).rejects.toThrow('Webhook timeout must be an integer between 1 and 60000 milliseconds.')
  })
})
