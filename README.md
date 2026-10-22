# eia-direct-claims-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-direct-claims-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Direct Claims
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Direct Claims federated remote: screens, widgets, record tabs, and transaction composition. Direct claims: FNOL, coverage, injury, reserves, litigation, settlement, and recovery.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Local run

```powershell
npm install
npm start
```

The remote listens on **3004** and proxies `/api` to `http://localhost:8088`. It exposes
`./App` as the Webpack Module Federation container `eia_direct_claims`. Claim and policy
requests send `X-EIA-Tenant` and `X-EIA-Book: DIRECT`; shared or platform reads (parties,
documents, the event inbox, and the people/team directory) are scoped by tenant only or are
public. `GET /api/v1/directory` is public master data, so it carries neither header and is
fetched once when the app starts, then reused in memory.

`npm run build` produces the production bundle. `npm test` runs the Playwright tests against
a mocked API. `@swc/core` is pinned to exactly `1.10.7`.

The workbench lists claims and opens a selected claim with tabs for:
injuries and exposures, reserve history (derived current reserve plus the append-only
ledger), coverage, policy-year allocations, litigation, settlements, and recoveries and liens.
Money is displayed from the decimal strings returned by the domain.

The **Allocations** tab sits after **Coverage** and reads
`GET /api/v1/claims/{claimId}/allocations`. Its summary shows the allocated amount, allocated
percentage, unallocated amount against the current reserve, and the allocation count. The
table shows policy year, layer, allocation percentage, allocated amount, the policy limit, the
erosion status, and a policy link. The form is fixed to the claim's policy (policy number and
link) and collects a policy year, layer (for example `PRIMARY` or `EXCESS_1`), a 0-100
allocation percent, the allocated amount, and an optional **Policy limit**. The percent is sent
to `POST /api/v1/claims/{claimId}/allocations` as a fraction, and the form prevents the claim's
allocation total from exceeding 100%, showing the remaining percent as the user types.

Opening the tab (or selecting another claim) also reads the policy's coverage and limit
schedule from
`GET /api/v1/policies/{policyId}/coverages?page=0&size=100` with the tenant and DIRECT book
headers. Each `{coverage, limit, state}` item is flattened into a limit option carrying the
`limitId`, coverage code/type, original limit amount, and current remaining amount; choosing
one shows its coverage, limit, and remaining values under the select and adds `limitId` to the
allocation request. With no limit selected the allocation is still recorded, no policy-limit
erosion is posted, and the form explains why. A policy-limit read failure is non-blocking: it
shows **Retry limits** while the allocation form remains usable.

Posting an allocation with a limit sends an erosion fact to Policy, which owns the limit
ledger. The allocation response carries `limitId`, `erosionStatus`
(`NOT_POSTED` / `POSTED` / `FAILED`), `erosionMessage`, and `erosionPostedAt`; the new row shows
those as a **Not posted**, **Posted**, or **Failed** badge. A failed row shows the Policy
message and a **Retry erosion** action that calls
`POST /api/v1/claims/{claimId}/allocations/{allocationId}/erosion`; the allocation stays intact
and retryable, and a retry failure keeps the failed row and displays the error beside it. A
successful create refreshes the ledger and the claim record and reports the erosion outcome; a
409 conflict keeps the entered values and offers **Reload allocations**. Loading, error, and
empty states stay inside the tab. Allocation distributes the claim loss across policy years and
layers; it does not change the reserve or the coverage position, and Policy owns the limit
ledger.

Ownership is visible in the record header, the **Assigned to** summary card, and each queue
row (`assignedAdjuster` / `assignedTeam`, or **Unassigned**). **Assign** opens a dialog with:

- an **Assigned adjuster** select built from `GET /api/v1/directory` people, showing each
  person's display name and role; the selected person's role and email are shown underneath;
- a **Team** select built from the directory `{code,label}` teams, narrowed to the selected
  person's team codes when the directory has routing data and otherwise showing every team;
- the current `assignedAdjuster` preselected when it matches a directory person (otherwise
  `A. Adjuster`), and the current team when it belongs to that person (otherwise their first
  team).

If the directory is unavailable the dialog keeps a free-text adjuster input and the static
assignment team list, so ownership can still be changed. Saving sends

```http
PATCH /api/v1/claims/{claimId}/assignment
X-EIA-Book: DIRECT
X-EIA-Actor: A. Adjuster

{ "assignedAdjuster": "A. Adjuster", "assignedTeam": "DIRECT_CLAIMS", "expectedVersion": 3 }
```

with the claim version read from the record. A stale version returns 409; the dialog keeps
the user's input, explains that the claim changed, and offers **Reload claim** so the latest
version can be read before retrying. On success the claim detail and queue are refreshed. The
queue filter also matches the assigned adjuster and team. Assignment is an operational
routing decision only: it determines the queue and workload, and never changes coverage,
reserves, settlements, payments, or other financial data.

An authorized or executed settlement can be handed to the **Payment** remote through
`/payment?new=1&sourceType=DIRECT_CLAIM&sourceId=…&sourceReference=…&amount=…&currency=…&payeePartyId=…`.
Direct Claims never creates the payment itself; the Payment workbench confirms the source and
saves it. The Settlements tab lists related payments via
`GET /api/v1/payments/search?q=<claimId>&limit=5` and links each one back to `/payment?record=<id>`.

An **AUTHORIZED** or **EXECUTED** settlement can also be linked to an existing paid claim
payment. The settlements table adds a **Payment** column showing the linked payment number and
status (both hydrated through `GET /api/v1/payments/{paymentId}` when the settlement projection
carries only `paymentId`), or **—** when unlinked. A `PAID` payment shows a green status badge.
If the linked payment is no longer `PAID` (`REVERSED`, `RETURNED`, `VOID`, `CANCELLED`, or
`FAILED`), the row shows a red badge and the warning **Payment &lt;status&gt; — settlement link
needs review** linked to the payment record. A failed status read is contained: the projected
number still renders, no badge or warning is invented, and the tab stays usable. Rows offer
**Link payment**, and **Unlink** stays available once linked, including while the warning is
shown. The link dialog
reads `GET /api/v1/payments?sourceType=DIRECT_CLAIM&sourceId=<claimId>` with `X-EIA-Tenant` and
`X-EIA-Book: DIRECT`, lists only `PAID` payments with source `DIRECT_CLAIM`, and shows a payment
already linked to another settlement on the claim with a **Linked to …** badge and a disabled
selector so it cannot be linked twice. Saving sends
`PATCH /api/v1/claims/{claimId}/settlements/{settlementId}/payment` with `{ "paymentId": … }`;
unlinking asks for confirmation and sends `{ "paymentId": null }`. The row updates from the
response and the claim record refreshes. When no PAID claim payment exists, the dialog explains
that a payment must be created, approved, and paid in the Payment workbench first and links to
the settlement hand-off. Linking records evidence only: it does not change the payment status or
the settlement paid loss, and Payment remains the system of record. A reversed, returned, voided,
cancelled, or failed payment does not change the settlement or its paid loss automatically; the
operator must unlink the payment or re-execute the settlement as policy requires.

The **Overview** adds a **Payments** card after **Documents**. It reads the claim-scoped
`GET /api/v1/payments?sourceType=DIRECT_CLAIM&sourceId=<claimId>` with `X-EIA-Tenant` and
`X-EIA-Book: DIRECT` (the same book wall the workbench's other Payment calls send) and accepts
either a bare array or an `{items:[...]}` envelope. Each row shows the payment number linked to
`/payment?record=<id>`, status, amount and currency, payee (`payeeName`, falling back to
`payeePartyId`), and created date, with a summary of total paid per currency and the pending
count. The lookup is card-local: loading, failure, and empty states never block or alter the
claim. The empty state explains the settlement hand-off, and the context note states that
Payment owns approval and execution while the claim keeps the settlement and paid-loss record.

The **Activity** tab sits after **Diary & Notes** and renders the claim's record timeline from the
platform event inbox (`GET /api/v1/events/aggregate/{claimId}?limit=50`, scoped by
`X-EIA-Tenant`). Rows show the `occurredAt` timestamp, a human-readable event name, the inbox
status and event version, concise payload facts (status transition, reserve amount, coverage
position, settlement amount, task/note, payment source), and the raw event type in mono. The card
fetches independently of the claim record with its own loading, error, and empty states; it
refreshes on demand and when the selected claim changes, so an unavailable inbox never blocks or
changes the claim. The context note states that the timeline is a read-only projection of the
append-only event inbox and that the business claim record remains the source of truth.

## Verification

- `npm run build` - production webpack bundle.
- `npx playwright test` - registration, reserve-history, coverage, allocations (list and
  summary, 0-100 percent sent as a fraction, exactly-100 boundary, remaining-percent hint,
  over-100 client validation, policy-limit fetch/flatten and options, optional `limitId`
  payload, posted/failed erosion badges, failed-row message and retry endpoint, no-limit
  behavior, limit-read failure containment/retry, empty and loading states, 503
  containment/retry, and 409 conflict reload), settlement-to-payment hand-off,
  related-payments, settlement payment linking (Payment column/number and live status
  hydration, PAID badge without warning, REVERSED badge/warning/context and Payment link,
  contained status-read failure, PAID-only `DIRECT_CLAIM` picker with already-linked payments
  disabled, link/unlink PATCH payloads, unlink confirmation including a reversed link,
  no-PAID-payment guidance, and PATCH/list error containment),
  assignment (directory
  fetch/cache, person options with role hints, team filtering, displayName/team submission,
  pre-filled and unassigned states, queue filtering, 409 stale reload, and the directory-503
  free-text/static-team fallback), overview payments (source path/query plus tenant and DIRECT
  book headers, array and `{items}` payloads, rows/link/payee/created date, paid-and-pending
  summary, empty hand-off context, 503 containment, non-blocking loading, and claim-change
  refetch), activity (aggregate path/tenant header, newest-first timeline, empty and 503
  states, payload summaries, and claim-change refetch), and tab-set flows with a mocked API;
  every domain request asserts the DIRECT book header.

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
