# ADR 002: D1-Backed Retry Scheduler

- Status: Accepted
- Date: 2026-08-04

## Context

Relay requires durable scheduling for initial deliveries and retries while operating on Cloudflare Workers.

## Decision

Cloudflare D1 is the source of truth for scheduled delivery work.

Delivery records store their status and next eligible attempt time. Scheduled Workers claim due work in bounded batches using conditional updates and lease metadata.

## Consequences

- Scheduled work survives Worker restarts.
- Claiming and lease expiration require concurrency tests.
- Batch sizes and polling frequency must remain within cost guardrails.
