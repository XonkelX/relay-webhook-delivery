import { describe, expect, it } from 'vitest'
import {
  createEndpointSigningSecret,
  decryptEndpointSecret,
  encryptEndpointSecret,
} from '../worker/lib/endpoint-secret-crypto.js'

const masterKeyV1 = btoa(
  String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)),
)

const keyring = {
  v1: masterKeyV1,
}

describe('endpoint secret encryption', () => {
  it('generates high-entropy endpoint signing secrets', () => {
    const first = createEndpointSigningSecret()
    const second = createEndpointSigningSecret()

    expect(first).toMatch(/^rly_whsec_[0-9a-f]{64}$/)
    expect(second).toMatch(/^rly_whsec_[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
  })

  it('round-trips a secret through AES-GCM', async () => {
    const secret = createEndpointSigningSecret()

    const encrypted = await encryptEndpointSecret(secret, 'ep_crypto_primary', 'v1', keyring)

    expect(encrypted.keyVersion).toBe('v1')
    expect(encrypted.ivBase64).not.toContain(secret)
    expect(encrypted.ciphertextBase64).not.toContain(secret)

    await expect(decryptEndpointSecret(encrypted, 'ep_crypto_primary', keyring)).resolves.toBe(
      secret,
    )
  })

  it('binds ciphertext to its endpoint ID', async () => {
    const encrypted = await encryptEndpointSecret(
      createEndpointSigningSecret(),
      'ep_crypto_owner',
      'v1',
      keyring,
    )

    await expect(decryptEndpointSecret(encrypted, 'ep_crypto_other', keyring)).rejects.toThrow(
      'Endpoint signing secret could not be decrypted.',
    )
  })

  it('rejects decryption with the wrong master key', async () => {
    const encrypted = await encryptEndpointSecret(
      createEndpointSigningSecret(),
      'ep_crypto_wrong_key',
      'v1',
      keyring,
    )

    const wrongKeyring = {
      v1: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => 255 - index))),
    }

    await expect(
      decryptEndpointSecret(encrypted, 'ep_crypto_wrong_key', wrongKeyring),
    ).rejects.toThrow('Endpoint signing secret could not be decrypted.')
  })

  it('rejects malformed master keys', async () => {
    await expect(
      encryptEndpointSecret(createEndpointSigningSecret(), 'ep_crypto_bad_key', 'v1', {
        v1: btoa('too-short'),
      }),
    ).rejects.toThrow('Endpoint secret master key must contain exactly 32 bytes.')
  })

  it('rejects unavailable key versions', async () => {
    await expect(
      encryptEndpointSecret(createEndpointSigningSecret(), 'ep_crypto_missing', 'v2', keyring),
    ).rejects.toThrow('Endpoint secret master key version v2 is unavailable.')
  })
})
