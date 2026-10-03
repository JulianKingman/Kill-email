# Testing Plan

## Summary

This project currently has no test suite. The initial test rollout uses a layered strategy:

1. Unit tests for deterministic business logic.
2. Integration tests for API/process orchestration.
3. Real IMAP integration tests backed by GreenMail in Docker.
4. Thin E2E smoke tests for core user flows.

## Real IMAP Test Strategy (GreenMail)

GreenMail is the default local IMAP backend for test runs.

Why GreenMail:

1. Purpose-built for email testing.
2. Supports IMAP and SMTP in one container.
3. Can be started/stopped just for tests.
4. Allows deterministic data seeding via SMTP before assertions.

### Local test instance

- Docker image: `greenmail/standalone:2.1.1`
- IMAP: `127.0.0.1:3143`
- SMTP (for seeding): `127.0.0.1:3025`
- Test user: `test@local.test`

### Seeding requirement

Integration tests must seed known test messages before IMAP assertions. Seed via SMTP so the mailbox contains realistic MIME messages.

Seed fields:

1. `from`
2. `to`
3. `subject`
4. `body`

Test cases must use unique subjects (timestamp-based IDs) and poll briefly for message visibility.

## Scope By Layer

### Unit tests

- `EmailOrganizer`: fate-to-action mapping, stats accounting, fallback behavior.
- `EmailCategorizer`: parsing, escalation thresholds, knob behavior.
- `SessionManager`: session lifecycle, stale cleanup, websocket fanout.
- `ConfigManager`: merge semantics, preset application, readiness checks.

### Integration tests

- Express routes (`/api/config`, `/api/email`, `/api/process`).
- Processing pipeline orchestration with mocks for LLM and websocket delivery.

### Real IMAP integration tests (GreenMail)

- Connect/authenticate against local IMAP.
- Fetch seeded messages.
- Move messages between folders.
- Delete/move-to-trash behavior.
- Folder creation behavior.

## CI Rollout

1. Run unit tests on every PR.
2. Run GreenMail IMAP integration tests on PR and nightly.
3. Run E2E smoke tests on PR and nightly.
4. Enforce coverage thresholds after initial stabilization.
