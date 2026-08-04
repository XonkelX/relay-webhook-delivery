import { readFile } from 'node:fs/promises'

const configUrl = new URL('../config/cost-guardrails.json', import.meta.url)
const config = JSON.parse(await readFile(configUrl, 'utf8'))

const failures = []

function checkInteger(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

checkInteger('scheduler.intervalMinutes', config.scheduler?.intervalMinutes, 1, 60)
checkInteger('scheduler.maxClaimsPerTick', config.scheduler?.maxClaimsPerTick, 1, 100)
checkInteger('scheduler.maxClaimsPerDay', config.scheduler?.maxClaimsPerDay, 1, 50000)
checkInteger('delivery.maxAttempts', config.delivery?.maxAttempts, 1, 8)
checkInteger('delivery.requestTimeoutMs', config.delivery?.requestTimeoutMs, 1000, 30000)
checkInteger('delivery.maxPayloadBytes', config.delivery?.maxPayloadBytes, 1024, 262144)
checkInteger('delivery.maxResponseCaptureBytes', config.delivery?.maxResponseCaptureBytes, 0, 16384)
checkInteger('retention.eventDays', config.retention?.eventDays, 1, 90)
checkInteger('retention.attemptDays', config.retention?.attemptDays, 1, 90)

if (failures.length === 0) {
  const ticksPerDay = Math.ceil(1440 / config.scheduler.intervalMinutes)
  const possibleClaimsPerDay = ticksPerDay * config.scheduler.maxClaimsPerTick

  if (possibleClaimsPerDay > config.scheduler.maxClaimsPerDay) {
    failures.push(
      `scheduler can claim ${possibleClaimsPerDay} records per day, exceeding the configured ceiling of ${config.scheduler.maxClaimsPerDay}`,
    )
  }
}

if (failures.length > 0) {
  console.error('Cost guardrail validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log('Cost guardrails are valid.')
}
