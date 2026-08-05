import { describe, expect, it } from 'vitest'
import { createApiKeyMaterial, parseBearerToken, sha256Hex } from '../worker/lib/auth'
import { createPrefixedId } from '../worker/lib/ids'

describe('prefixed identifiers', () => {
  it('creates identifiers with the requested canonical prefix', () => {
    expect(createPrefixedId('evt')).toMatch(/^evt_[a-f0-9]{32}$/)
    expect(createPrefixedId('dlv')).toMatch(/^dlv_[a-f0-9]{32}$/)
  })

  it('uses fresh entropy for each identifier', () => {
    expect(createPrefixedId('att')).not.toBe(createPrefixedId('att'))
  })
})

describe('API-key security utilities', () => {
  it('parses bearer authentication case-insensitively', () => {
    expect(parseBearerToken('Bearer rly_live_secret')).toBe('rly_live_secret')
    expect(parseBearerToken('bearer rly_live_secret')).toBe('rly_live_secret')
  })

  it.each([null, '', 'Basic credentials', 'Bearer', 'Bearer first second'])(
    'rejects malformed authorization value %s',
    (value) => {
      expect(parseBearerToken(value)).toBeNull()
    },
  )

  it('produces a deterministic SHA-256 digest', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('creates API-key material without storing the raw key as its hash', async () => {
    const material = await createApiKeyMaterial()

    expect(material.rawKey).toMatch(/^rly_live_[a-f0-9]{64}$/)
    expect(material.keyPrefix).toBe(material.rawKey.slice(0, material.keyPrefix.length))
    expect(material.keyPrefix.length).toBe(16)
    expect(material.secretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(material.secretHash).not.toContain(material.rawKey)
    await expect(sha256Hex(material.rawKey)).resolves.toBe(material.secretHash)
  })
})
