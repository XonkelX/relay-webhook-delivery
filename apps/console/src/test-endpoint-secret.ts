export const TEST_ENDPOINT_SECRET_KEYRING = {
  v1: btoa('t'.repeat(32)),
}

export const TEST_ENDPOINT_SECRET_KEY_VERSION = 'v1'

export const TEST_ENDPOINT_SIGNING_SECRET = `rly_whsec_${'a'.repeat(64)}`

export const TEST_ENDPOINT_CRYPTO_DEPENDENCIES = {
  endpointSecretKeyVersion: TEST_ENDPOINT_SECRET_KEY_VERSION,
  endpointSecretKeyring: TEST_ENDPOINT_SECRET_KEYRING,
}
