import type { JsonValue } from '@relay/contracts'

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`
  }

  const properties = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key]!)}`)

  return `{${properties.join(',')}}`
}
