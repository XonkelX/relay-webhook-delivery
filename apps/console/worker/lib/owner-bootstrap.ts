import { sha256Hex } from './auth.js'

const MIN_BOOTSTRAP_TOKEN_BYTES = 32
const MAX_BOOTSTRAP_TOKEN_BYTES = 512
const encoder = new TextEncoder()

function constantTimeEqual(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length)

  let difference = left.length ^ right.length

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }

  return difference === 0
}

function validateConfiguredToken(token: string): void {
  const byteLength = encoder.encode(token).byteLength

  if (byteLength < MIN_BOOTSTRAP_TOKEN_BYTES || byteLength > MAX_BOOTSTRAP_TOKEN_BYTES) {
    throw new TypeError('Owner bootstrap token must contain between 32 and 512 UTF-8 bytes.')
  }
}

export async function verifyOwnerBootstrapToken(
  submittedToken: string,
  configuredToken: string,
): Promise<boolean> {
  validateConfiguredToken(configuredToken)

  const [submittedHash, configuredHash] = await Promise.all([
    sha256Hex(submittedToken),
    sha256Hex(configuredToken),
  ])

  return constantTimeEqual(submittedHash, configuredHash)
}
