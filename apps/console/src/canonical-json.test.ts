import { describe, expect, it } from 'vitest'
import { canonicalizeJson } from '../worker/lib/canonical-json.js'

describe('canonical JSON', () => {
  it('sorts object keys recursively', () => {
    expect(
      canonicalizeJson({
        z: 1,
        nested: {
          b: true,
          a: 'first',
        },
        a: null,
      }),
    ).toBe('{"a":null,"nested":{"a":"first","b":true},"z":1}')
  })

  it('preserves array order', () => {
    expect(canonicalizeJson([{ second: 2, first: 1 }, 'value', false])).toBe(
      '[{"first":1,"second":2},"value",false]',
    )
  })

  it('produces the same output for equivalent objects', () => {
    const first = {
      type: 'order.completed',
      data: {
        orderId: 'ord_123',
        amount: 4200,
      },
    }

    const second = {
      data: {
        amount: 4200,
        orderId: 'ord_123',
      },
      type: 'order.completed',
    }

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second))
  })
})
