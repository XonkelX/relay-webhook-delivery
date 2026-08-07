import { describe, expect, it } from 'vitest'
import { MAX_ENDPOINT_URL_LENGTH, normalizeEndpointUrl } from '../worker/lib/endpoint-url-policy.js'

describe('endpoint URL policy', () => {
  it.each([
    'http://hooks.example.com/events',
    'ftp://hooks.example.com/events',
    'https://127.0.0.1/events',
    'https://2130706433/events',
    'https://[::1]/events',
    'https://localhost/events',
    'https://api.localhost/events',
    'https://receiver.local/events',
    'https://receiver.internal/events',
    'https://service.home.arpa/events',
    'https://intranet/events',
    'https://user:secret@hooks.example.com/events',
    'https://hooks.example.com/events#secret',
    'https://hooks.example.com:8443/events',
  ])('rejects blocked target %s', (url) => {
    expect(() => normalizeEndpointUrl(url)).toThrow(TypeError)
  })

  it('rejects oversized URLs', () => {
    const url = 'https://hooks.example.com/' + 'a'.repeat(MAX_ENDPOINT_URL_LENGTH)

    expect(() => normalizeEndpointUrl(url)).toThrow(TypeError)
  })

  it('normalizes a public HTTPS endpoint', () => {
    expect(normalizeEndpointUrl('  https://HOOKS.EXAMPLE.com:443/events?source=relay  ')).toBe(
      'https://hooks.example.com/events?source=relay',
    )
  })

  it('allows nested public hostnames', () => {
    expect(normalizeEndpointUrl('https://webhooks.api.example.com/v1/relay')).toBe(
      'https://webhooks.api.example.com/v1/relay',
    )
  })
})
