# Relay Threat Model

- Status: Active
- Last reviewed: 2026-08-07
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

## Implemented Mitigations

- Return endpoint signing secrets only when initially created or explicitly rotated; persist only AES-GCM encrypted secret material.
- Bind encrypted endpoint secrets to endpoint identity and a versioned Worker-held master key.
- Allow only a bounded previous-secret grace window during rotation and emit active-plus-previous signatures only during that window.
- Require signed challenge-response verification before an endpoint becomes active.
- Return changed endpoint URLs to pending verification and cancel their scheduled delivery work.
- Require HTTPS destination URLs and reject credentials, fragments, IP literals, single-label or private-style hostnames, and explicit non-443 ports.
- Disable automatic redirects for verification and delivery requests so redirect chains cannot bypass the submitted destination policy.
- Prevent pending, paused, or disabled endpoints from executing queued deliveries.
- Protect owner sessions with signed Secure HttpOnly SameSite=Strict cookies, short TTLs, CSRF binding for mutations, revocation, and explicit logout.
- Apply fail-closed per-key and global daily event quotas backed by transactional D1 counters.
- Apply restrictive CSP and browser-origin policy plus no-store and defensive HTTP response headers.
- Return generic server errors without exposing internal exception details.
- Redact secrets and authorization data from logs.
- Keep public demo mode read-only and logically separated.
- Use timestamped webhook signatures with documented verification tolerance.
- Persist attempts and use conditional claims with lease expiration.
- Enforce payload, response, retry, and batch-size limits.
- Truncate and sanitize captured response data.
- Document that consumers must implement idempotency.

## Deferred Risks

The following require further design before production release:

- DNS resolution and rebinding defenses beyond the current hostname and IP-literal destination policy
- Owner authentication bootstrap and provider selection
- Public Failure Lab abuse controls and broader rate limiting
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
