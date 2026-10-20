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
- Directory-backed assignment: the workbench fetches the public
  `GET /api/v1/directory` people/team master data once at start-up, caches it for the app
  session, and uses it to replace the free-text adjuster field with a person select
  (`displayName` plus role) and a role/email hint. The team select shows directory
  `{code,label}` options narrowed to the selected person's team codes when available and all
  teams otherwise; the current owner is preselected when they match a directory person
  (otherwise `A. Adjuster`) and the current team is kept when valid (otherwise the person's
  first team). Assignment still sends the display name, team code, and `expectedVersion`.
  When the directory returns 503 the dialog retains the free-text adjuster and static team
  fallback. Playwright covers the fetch/cache, options, filtering, submission, and fallback.
- Claim activity timeline: an **Activity** tab after **Diary & Notes** renders
  `GET /api/v1/events/aggregate/{claimId}?limit=50` scoped by `X-EIA-Tenant`. Rows show the
  `occurredAt` timestamp, a human-readable event name, inbox status and event version, concise
  payload facts (status transition, reserve amount, coverage position, settlement amount,
  task/note, payment source), and the raw event type in mono. The card-local fetch has
  loading, error, and empty states, refreshes on demand and when the selected claim changes,
  and never blocks or alters the claim record. Playwright covers the aggregate path/header,
  newest-first order, empty and 503 states, payload summaries, and claim-change refetch.
- Claim payments card: the Overview renders a **Payments** card after **Documents** backed by
  `GET /api/v1/payments?sourceType=DIRECT_CLAIM&sourceId=<claimId>` with the tenant and DIRECT
  book headers. Rows show the payment number linked to `/payment?record=<id>`, status, amount
  and currency, payee (`payeeName` or `payeePartyId`), and created date; the summary totals
  paid amounts per currency and counts pending payments. The fetch is card-local with loading,
  error, and empty states that never block the claim, the empty state explains the settlement
  hand-off, and the context note states that Payment owns approval/execution while the claim
  holds the settlement and paid-loss record. Playwright covers the request path/query/headers,
  array and `{items}` payloads, rows and links, empty state, 503 containment, non-blocking
  loading, and claim-change refetch.
- Policy-year allocations: an **Allocations** tab after **Coverage** reads
  `GET /api/v1/claims/{claimId}/allocations` and shows the allocated amount, allocated
  percentage, unallocated amount against the current reserve, and the allocation count. The
  table lists policy year, layer, allocation percentage, allocated amount, and a policy link.
  The create form is fixed to the claim policy (policy number/link) and posts `policyId`,
  `policyYear`, `layer`, a 0-100 percent sent as a fraction, and `allocatedAmount` to
  `POST /api/v1/claims/{claimId}/allocations`. The form validates that the claim total stays
  at or below 100%, shows the remaining percent, keeps the user's values and offers
  **Reload allocations** on a 409, and contains loading, error, and empty states in the tab.
  The context panel states that allocation distributes the claim loss across policy years and
  layers without changing the reserve or coverage, and that Policy owns the limit ledger.
- Policy-limit selection and allocation erosion: the **Allocations** tab reads the claim
  policy's coverage/limit schedule from
  `GET /api/v1/policies/{policyId}/coverages?page=0&size=100` with the tenant and DIRECT book
  headers when the tab opens or the claim changes. Each `{coverage, limit, state}` item is
  flattened to `{limitId, coverageType/code, originalAmount, remainingAmount}` for an optional
  **Policy limit** select that shows the chosen coverage, original limit, and remaining amount.
  Selecting a limit adds `limitId` to the allocation create; leaving it empty records the
  allocation without erosion and explains why. The table adds the policy limit and an erosion
  badge from the allocation DTO (`NOT_POSTED`, `POSTED`, `FAILED`, plus `erosionMessage` and
  `erosionPostedAt`). A failed row shows the Policy message and a **Retry erosion** action that
  calls `POST /api/v1/claims/{claimId}/allocations/{allocationId}/erosion`; the allocation is
  never removed, a failed retry keeps the row and shows the error, and a posted retry updates
  the badge and timestamp. The create response's erosion outcome is reported in the status
  line, the policy-limit read failure is non-blocking with **Retry limits**, and the context
  panel states that posting erodes the selected limit while Policy owns the limit ledger.
  Playwright covers the limit fetch/flatten/options, optional `limitId` payload, posted and
  failed badges, the retry endpoint, no-limit behavior, create-time failure, retry failure, and
  limit-read failure containment.
