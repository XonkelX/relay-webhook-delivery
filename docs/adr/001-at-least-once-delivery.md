# ADR 001: At-Least-Once Webhook Delivery

- Status: Accepted
- Date: 2026-08-04

## Context

Network failures, timeouts, and interrupted execution make exactly-once webhook delivery impractical.

## Decision

Relay provides at-least-once delivery. An event may be delivered more than once, and every delivery attempt is recorded separately.

Webhook consumers are responsible for idempotent processing.

## Consequences

- Duplicate deliveries are possible.
- Retry behavior must be deterministic and observable.
- Relay must not claim exactly-once delivery.
