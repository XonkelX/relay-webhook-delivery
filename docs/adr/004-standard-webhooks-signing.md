# ADR 004: Standard Webhooks-Compatible Signing

- Status: Accepted
- Date: 2026-08-04

## Context

Webhook receivers require a consistent way to verify authenticity, integrity, and freshness.

## Decision

Relay adopts a Standard Webhooks-compatible signing format.

Signature headers, timestamps, secret representation, verification examples, and tests must remain consistent across Relay, Relay Lab, and the documentation.

## Consequences

- Signing requires shared contract tests.
- Timestamp tolerance and malformed signatures must be handled explicitly.
- Secrets must never appear in logs or public demo data.
