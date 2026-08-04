# Relay Cost Guardrails

These limits are project-owned operational ceilings. They are not Cloudflare quota definitions.

## Scheduler

- Run no more frequently than once per minute.
- Claim at most 25 delivery records per scheduler tick.
- Permit no more than 50,000 potential claims per day.

## Delivery

- Permit at most 8 attempts per event.
- Limit each outbound request to 10 seconds.
- Accept payloads no larger than 256 KiB.
- Capture no more than 16 KiB from a destination response.

## Retention

- Retain events for 30 days by default.
- Retain delivery attempts for 30 days by default.

## Enforcement

Run `npm run check:cost` locally and in CI.

The check must fail when configuration values are missing, invalid, or exceed the committed project ceilings. Provider limits must be reviewed separately before deployment.
