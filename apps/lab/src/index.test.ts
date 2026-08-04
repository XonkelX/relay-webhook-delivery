import { describe, expect, it } from 'vitest'
import app from './index'

describe('Relay Lab Worker', () => {
  it('returns its health status', async () => {
    const response = await app.request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'relay-lab',
    })
  })
})
