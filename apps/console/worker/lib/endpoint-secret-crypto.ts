const ENDPOINT_SECRET_BYTES = 32
const AES_GCM_IV_BYTES = 12
const AES_256_KEY_BYTES = 32
const ENDPOINT_SECRET_PREFIX = 'rly_whsec_'

export interface EncryptedEndpointSecret {
  keyVersion: string
  ivBase64: string
  ciphertextBase64: string
}

export type EndpointSecretKeyring = Readonly<Record<string, string>>

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  let binary: string

  try {
    binary = atob(value)
  } catch {
    throw new TypeError('Endpoint secret master key must be valid base64.')
  }

  const bytes = new Uint8Array(new ArrayBuffer(binary.length))

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function importMasterKey(
  keyVersion: string,
  keyring: EndpointSecretKeyring,
): Promise<CryptoKey> {
  const encoded = keyring[keyVersion]

  if (!encoded) {
    throw new Error(`Endpoint secret master key version ${keyVersion} is unavailable.`)
  }

  const keyBytes = base64ToBytes(encoded)

  if (keyBytes.byteLength !== AES_256_KEY_BYTES) {
    throw new TypeError('Endpoint secret master key must contain exactly 32 bytes.')
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'AES-GCM',
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

function additionalData(endpointId: string, keyVersion: string): Uint8Array<ArrayBuffer> {
  if (!endpointId.startsWith('ep_')) {
    throw new TypeError('Endpoint ID must use the ep_ prefix.')
  }

  const encoded = new TextEncoder().encode(`relay:endpoint-secret:${keyVersion}:${endpointId}`)
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength))

  bytes.set(encoded)

  return bytes
}

export function createEndpointSigningSecret(): string {
  const secret = new Uint8Array(ENDPOINT_SECRET_BYTES)

  crypto.getRandomValues(secret)

  return `${ENDPOINT_SECRET_PREFIX}${bytesToHex(secret)}`
}

export async function encryptEndpointSecret(
  plaintext: string,
  endpointId: string,
  keyVersion: string,
  keyring: EndpointSecretKeyring,
): Promise<EncryptedEndpointSecret> {
  if (!plaintext.startsWith(ENDPOINT_SECRET_PREFIX)) {
    throw new TypeError('Endpoint signing secret has an invalid format.')
  }

  if (!keyVersion.trim()) {
    throw new TypeError('Endpoint secret key version is required.')
  }

  const key = await importMasterKey(keyVersion, keyring)
  const iv = new Uint8Array(AES_GCM_IV_BYTES)

  crypto.getRandomValues(iv)

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(endpointId, keyVersion),
    },
    key,
    new TextEncoder().encode(plaintext),
  )

  return {
    keyVersion,
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptEndpointSecret(
  encrypted: EncryptedEndpointSecret,
  endpointId: string,
  keyring: EndpointSecretKeyring,
): Promise<string> {
  const key = await importMasterKey(encrypted.keyVersion, keyring)

  const iv = base64ToBytes(encrypted.ivBase64)
  const ciphertext = base64ToBytes(encrypted.ciphertextBase64)

  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new TypeError('Endpoint secret IV must contain exactly 12 bytes.')
  }

  let plaintext: ArrayBuffer

  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: additionalData(endpointId, encrypted.keyVersion),
      },
      key,
      ciphertext,
    )
  } catch {
    throw new Error('Endpoint signing secret could not be decrypted.')
  }

  return new TextDecoder().decode(plaintext)
}
