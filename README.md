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
`./App` as the Webpack Module Federation container `eia_direct_claims`. Every API request
sends `X-EIA-Tenant` and `X-EIA-Book: DIRECT`.

`npm run build` produces the production bundle. `npm test` runs the Playwright tests against
a mocked API. `@swc/core` is pinned to exactly `1.10.7`.

The workbench lists claims and opens a selected claim with tabs for:
injuries and exposures, reserve history (derived current reserve plus the append-only
ledger), coverage, litigation, settlements, and recoveries and liens. Money is displayed from
the decimal strings returned by the domain.

An authorized or executed settlement can be handed to the **Payment** remote through
`/payment?new=1&sourceType=DIRECT_CLAIM&sourceId=…&sourceReference=…&amount=…&currency=…&payeePartyId=…`.
Direct Claims never creates the payment itself; the Payment workbench confirms the source and
saves it. The Settlements tab lists related payments via
`GET /api/v1/payments/search?q=<claimId>&limit=5` and links each one back to `/payment?record=<id>`.

## Verification

- `npm run build` - production webpack bundle.
- `npx playwright test` - registration, reserve-history, coverage, settlement-to-payment
  hand-off, related-payments, and tab-set flows with a mocked API; every request asserts the
  DIRECT book header.

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
