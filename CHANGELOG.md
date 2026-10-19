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
