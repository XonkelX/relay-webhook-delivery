const API_KEY_NAMESPACE = 'rly_live_'
const API_KEY_SECRET_BYTES = 32
const DISPLAY_PREFIX_LENGTH = 16

export interface ApiKeyMaterial {
  rawKey: string
  keyPrefix: string
  secretHash: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)

  return bytesToHex(new Uint8Array(digest))
}

export function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null
  }

  const parts = authorizationHeader.trim().split(/\s+/)

  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return null
  }

  return parts[1]
}

export async function createApiKeyMaterial(): Promise<ApiKeyMaterial> {
  const secret = new Uint8Array(API_KEY_SECRET_BYTES)
  crypto.getRandomValues(secret)

  const rawKey = `${API_KEY_NAMESPACE}${bytesToHex(secret)}`

  return {
    rawKey,
    keyPrefix: rawKey.slice(0, DISPLAY_PREFIX_LENGTH),
    secretHash: await sha256Hex(rawKey),
  }
}
