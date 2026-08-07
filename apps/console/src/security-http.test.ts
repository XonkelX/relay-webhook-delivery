import { describe, expect, it } from 'vitest'
import app from '../worker/index.js'

describe('Worker HTTP security policy', () => {
  it('adds hardened response headers', async () => {
    const response = await app.request('/api/health')

    expect(response.status).toBe(200)

    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    expect(response.headers.get('x-frame-options')).toBe('DENY')

    expect(response.headers.get('referrer-policy')).toBe('no-referrer')

    expect(response.headers.get('permissions-policy')).toContain('camera=()')

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('allows browser requests from the same origin', async () => {
    const response = await app.request('/api/health', {
      headers: {
        Origin: 'http://localhost',
      },
    })

    expect(response.status).toBe(200)
  })

  it('rejects cross-origin browser API requests', async () => {
    const response = await app.request('/api/health', {
      headers: {
        Origin: 'https://evil.example',
      },
    })

    expect(response.status).toBe(403)

    expect(await response.json()).toEqual({
      error: {
        code: 'CROSS_ORIGIN_REJECTED',
        message: 'Cross-origin API requests are not allowed.',
      },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('rejects opaque Origin values', async () => {
    const response = await app.request('/api/health', {
      headers: {
        Origin: 'null',
      },
    })

    expect(response.status).toBe(403)
  })

  it('still permits non-browser API clients without Origin', async () => {
    const response = await app.request('/api/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
