import type { EndpointSecretKeyring } from './endpoint-secret-crypto.js'

export interface EndpointSecretMasterKeyEnvironment {
  ENDPOINT_SECRET_MASTER_KEY_V1?: string
  ENDPOINT_SECRET_MASTER_KEY_V2?: string
}

export function buildEndpointSecretKeyring(
  environment: EndpointSecretMasterKeyEnvironment,
): EndpointSecretKeyring {
  const keyring: Record<string, string> = {}

  if (environment.ENDPOINT_SECRET_MASTER_KEY_V1) {
    keyring.v1 = environment.ENDPOINT_SECRET_MASTER_KEY_V1
  }

  if (environment.ENDPOINT_SECRET_MASTER_KEY_V2) {
    keyring.v2 = environment.ENDPOINT_SECRET_MASTER_KEY_V2
  }

  if (Object.keys(keyring).length === 0) {
    throw new Error('No endpoint secret master key is configured.')
  }

  return keyring
}
