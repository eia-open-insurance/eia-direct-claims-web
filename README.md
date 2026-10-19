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

`npm run build` produces the production bundle. `npm test` runs the Playwright test against
a mocked API. `@swc/core` is pinned to exactly `1.10.7`.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
