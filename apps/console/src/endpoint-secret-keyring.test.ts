import { describe, expect, it } from 'vitest'
import { buildEndpointSecretKeyring } from '../worker/lib/endpoint-secret-keyring.js'

describe('endpoint secret master-key environment', () => {
  it('builds a versioned keyring', () => {
    expect(
      buildEndpointSecretKeyring({
        ENDPOINT_SECRET_MASTER_KEY_V1: 'key-v1',
        ENDPOINT_SECRET_MASTER_KEY_V2: 'key-v2',
      }),
    ).toEqual({
      v1: 'key-v1',
      v2: 'key-v2',
    })
  })

  it('allows only the currently configured version', () => {
    expect(
      buildEndpointSecretKeyring({
        ENDPOINT_SECRET_MASTER_KEY_V1: 'key-v1',
      }),
    ).toEqual({
      v1: 'key-v1',
    })
  })

  it('fails closed when no master key exists', () => {
    expect(() => buildEndpointSecretKeyring({})).toThrow(
      'No endpoint secret master key is configured.',
    )
  })
})
