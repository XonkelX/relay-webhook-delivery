export const MAX_ENDPOINT_URL_LENGTH = 2048

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'] as const

function reject(message: string): never {
  throw new TypeError(message)
}

function normalizedHostname(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/\.$/, '')
}

function isIpLiteral(hostname: string): boolean {
  const unwrapped =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (unwrapped.includes(':')) {
    return true
  }

  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(unwrapped)
}

function isPrivateLikeHostname(hostname: string): boolean {
  if (hostname === 'localhost') {
    return true
  }

  if (!hostname.includes('.')) {
    return true
  }

  return BLOCKED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  )
}

export function normalizeEndpointUrl(value: string): string {
  const input = value.trim()

  if (input.length < 1) {
    return reject('Endpoint URL is required.')
  }

  if (input.length > MAX_ENDPOINT_URL_LENGTH) {
    return reject('Endpoint URL is too long.')
  }

  let parsed: URL

  try {
    parsed = new URL(input)
  } catch {
    return reject('Endpoint URL must be a valid HTTPS URL.')
  }

  if (parsed.protocol !== 'https:') {
    return reject('Endpoint URL must use HTTPS.')
  }

  if (parsed.username || parsed.password) {
    return reject('Endpoint URL must not contain credentials.')
  }

  if (parsed.hash) {
    return reject('Endpoint URL must not contain a fragment.')
  }

  if (parsed.port) {
    return reject('Endpoint URL must use port 443.')
  }

  const hostname = normalizedHostname(parsed)

  if (isIpLiteral(hostname)) {
    return reject('Endpoint URL must not use an IP-literal host.')
  }

  if (isPrivateLikeHostname(hostname)) {
    return reject('Endpoint URL must use a public hostname.')
  }

  parsed.hostname = hostname

  return parsed.toString()
}
