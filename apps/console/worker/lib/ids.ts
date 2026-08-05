export const relayIdPrefixes = ['key', 'ses', 'ep', 'evt', 'dlv', 'att', 'out', 'aud'] as const

export type RelayIdPrefix = (typeof relayIdPrefixes)[number]

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createPrefixedId(prefix: RelayIdPrefix): string {
  const entropy = new Uint8Array(16)
  crypto.getRandomValues(entropy)

  return `${prefix}_${bytesToHex(entropy)}`
}
