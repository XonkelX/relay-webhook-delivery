# Relay Threat Model

- Status: Draft
- Last reviewed: 2026-08-04
- Scope: Initial single-owner release and public demo mode

## System Summary

Relay accepts outbound webhook events, stores delivery state, signs requests, schedules delivery attempts, and records delivery results.

The system includes:

- Relay Console
- Relay API Worker
- Scheduled delivery Worker
- Cloudflare D1
- Relay Lab receiver
- External webhook destinations
- Owner authentication
- Read-only public demo mode

## Protected Assets

- Webhook signing secrets
- Owner authentication credentials and sessions
- Event payloads
- Endpoint URLs
- Delivery history and response metadata
- D1 records
- Operational logs

## Trust Boundaries

- Browser to Relay Worker
- Relay Worker to D1
- Delivery Worker to external destinations
- Relay to Relay Lab
- Authenticated owner mode to public demo mode
- Application code to logs and observability systems

## Primary Threats

### Secret Disclosure

Signing secrets could appear in logs, API responses, browser state, error messages, or demo data.

### Server-Side Request Forgery

A malicious destination URL could target private, local, metadata, or otherwise restricted network resources.

### Replay and Forgery

An attacker could replay a valid signed webhook or create a forged request with invalid signing data.

### Unauthorized Mutation

A public-demo user or unauthenticated request could create events, replay deliveries, rotate secrets, or delete data.

### Duplicate Processing

At-least-once delivery can cause a receiver to process the same event more than once.

### Scheduler Concurrency

Multiple Workers could claim or deliver the same scheduled attempt concurrently.

### Resource Exhaustion

Large payloads, excessive retries, unbounded logs, or abusive endpoint creation could consume platform limits.

### Sensitive Response Capture

Webhook response bodies or headers could contain secrets or personal information.

## Initial Mitigations

- Never expose stored signing secrets after creation.
- Redact secrets and authorization data from logs.
- Enforce owner authorization on every mutation route.
- Keep public demo mode read-only and logically separated.
- Validate and normalize destination URLs.
- Block unsafe destination addresses before delivery.
- Use timestamped signatures with documented verification tolerance.
- Persist attempts and use conditional claims with lease expiration.
- Enforce payload, response, retry, and batch-size limits.
- Truncate and sanitize captured response data.
- Document that consumers must implement idempotency.

## Deferred Risks

The following require further design before production release:

- Complete SSRF protection for redirects and DNS rebinding
- Authentication provider selection and session hardening
- Secret encryption and rotation lifecycle
- Abuse prevention and rate limiting
- Data-retention and deletion policies
- Incident response and audit-log requirements
- Multi-tenant isolation

## Validation Requirements

Security controls must be supported by automated tests where practical, including:

- Unauthorized mutation rejection
- Public-demo write rejection
- Signature verification failures
- Expired signature rejection
- Duplicate scheduler claim prevention
- Unsafe destination rejection
- Secret-redaction checks
