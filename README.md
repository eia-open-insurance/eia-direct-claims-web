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
documents, and the event inbox) are scoped by tenant only.

`npm run build` produces the production bundle. `npm test` runs the Playwright tests against
a mocked API. `@swc/core` is pinned to exactly `1.10.7`.

The workbench lists claims and opens a selected claim with tabs for:
injuries and exposures, reserve history (derived current reserve plus the append-only
ledger), coverage, litigation, settlements, and recoveries and liens. Money is displayed from
the decimal strings returned by the domain.

Ownership is visible in the record header, the **Assigned to** summary card, and each queue
row (`assignedAdjuster` / `assignedTeam`, or **Unassigned**). **Assign** opens a dialog
pre-filled with the current assignment or the current user (`A. Adjuster`) and the team.
Saving sends

```http
PATCH /api/v1/claims/{claimId}/assignment
X-EIA-Book: DIRECT
X-EIA-Actor: A. Adjuster

{ "assignedAdjuster": "…", "assignedTeam": "DIRECT_CLAIMS", "expectedVersion": 3 }
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
- `npx playwright test` - registration, reserve-history, coverage, settlement-to-payment
  hand-off, related-payments, assignment (payload/version, header/summary/queue refresh,
  unassigned and pre-filled states, queue filtering, and 409 stale reload), activity (aggregate
  path/tenant header, newest-first timeline, empty and 503 states, payload summaries, and
  claim-change refetch), and tab-set flows with a mocked API; every domain request asserts the
  DIRECT book header.

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
