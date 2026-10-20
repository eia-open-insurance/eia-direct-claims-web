# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- Direct Claims remote slice: React 19 workbench exposed as `./App` from the
  `eia_direct_claims` Module Federation container on port 3004, `/api` proxy to the domain
  service, DIRECT book header on every request, and a Playwright test with a mocked API.
- Second Direct Claims slice: the workbench gains claim selection and tabs for injuries and
  exposures, reserve history (derived current reserve plus the append-only ledger), coverage,
  litigation, settlements (propose/approve/execute), and recoveries and liens. Playwright
  covers the reserve-history and coverage flows and the mocked tab set.
- Cross-link transparency: selecting a claim resolves the policy (`policyNumber · productCode`)
  and claimant party (`displayName · partyNumber`) labels for the record subtitle, Overview
  key-value rows, context panel, and related policy link. Lookups are non-blocking and fall
  back to the short UUID when detail is unavailable; policy lookups carry the DIRECT book
  header and are not issued for assumed records.
- Claim assignment UX: the record header, **Assigned to** summary card, and queue rows show
  the assigned adjuster and team (or **Unassigned**). **Assign** opens a dialog pre-filled
  with the current assignment or `A. Adjuster`, posts
  `PATCH /api/v1/claims/{claimId}/assignment` with `assignedAdjuster`, `assignedTeam`, and
  `expectedVersion`, refreshes the detail and queue on success, and keeps the dialog open with
  a **Reload claim** action on a 409 stale version. The queue filter matches assignee and
  team; the context panel states that ownership only routes queue/workload and does not
  change coverage, reserves, payments, or other financials.
- Claim-to-payment hand-off: authorized, executed, approved, and paid settlements expose a
  **Create payment** action that navigates to the Payment workbench with the DIRECT claim
  source (`sourceType`, `sourceId`, `sourceReference`), settlement amount and currency, and
  claimant payee. Direct Claims does not create the payment; Payment confirms and saves it.
  The Settlements tab adds a **Related payments** card backed by
  `GET /api/v1/payments/search?q=<claimId>&limit=5`, and the Overview context panel states
  that Payment owns approval and execution.
- Claim activity timeline: an **Activity** tab after **Diary & Notes** renders
  `GET /api/v1/events/aggregate/{claimId}?limit=50` scoped by `X-EIA-Tenant`. Rows show the
  `occurredAt` timestamp, a human-readable event name, inbox status and event version, concise
  payload facts (status transition, reserve amount, coverage position, settlement amount,
  task/note, payment source), and the raw event type in mono. The card-local fetch has
  loading, error, and empty states, refreshes on demand and when the selected claim changes,
  and never blocks or alters the claim record. Playwright covers the aggregate path/header,
  newest-first order, empty and 503 states, payload summaries, and claim-change refetch.
