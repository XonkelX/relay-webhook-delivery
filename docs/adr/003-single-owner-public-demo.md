# ADR 003: Single Owner with Public Demo Mode

- Status: Accepted
- Date: 2026-08-04

## Context

Multi-tenant identity, organizations, invitations, and role-based access control would substantially expand the initial scope.

## Decision

The initial Relay release supports one authenticated owner.

A separate public demo mode may expose read-only sample data. Demo users cannot mutate operational data.

## Consequences

- Multi-tenancy is out of scope.
- Mutation routes must enforce owner authorization.
- Demo data must remain separated from owner data.
