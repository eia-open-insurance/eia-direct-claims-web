import { test, expect } from '@playwright/test';

const CLAIM = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21',
  tenantId: '11111111-1111-7111-8111-111111111111',
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000001',
  policyId: '22222222-2222-7222-8222-222222222222',
  claimantPartyId: '33333333-3333-7333-8333-333333333333',
  claimType: 'MASS_TORT',
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '0.0000',
  reserveCurrency: 'USD',
  settlementAuthorityAmount: '500000.0000',
  settlementAuthorityCurrency: 'USD',
  litigationFlag: false,
  currentReserveAmount: '0.0000',
  version: 0,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

function detailRoute(page, state) {
  return page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const marker = `/api/v1/claims/${CLAIM.id}/`;
    const section = url.pathname.slice(url.pathname.indexOf(marker) + marker.length).split('/')[0];
    state.requests.push({ method: request.method(), path: url.pathname, book: request.headers()['x-eia-book'] });

    if (request.method() === 'GET') {
      if (section === 'reserves') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.reserveSummary)
        });
        return;
      }
      if (section === 'coverage') {
        if (!state.coverage) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'NOT_FOUND', message: 'No coverage decision recorded' })
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.coverage)
        });
        return;
      }
      if (section === 'injuries') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    const payload = request.postDataJSON();
    if (section === 'reserves') {
      state.reserveBody = payload;
      const entry = {
        id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d33',
        tenantId: CLAIM.tenantId,
        claimId: CLAIM.id,
        component: payload.component,
        amount: Number(payload.amount).toFixed(4),
        currency: payload.currency,
        effectiveDate: payload.effectiveDate,
        reasonCode: payload.reasonCode,
        reasonText: payload.reasonText,
        authority: payload.authority,
        sequence: 1,
        current: true,
        version: 1,
        createdAt: '2026-03-18T09:10:00Z'
      };
      state.reserveSummary = {
        claimId: CLAIM.id,
        currency: payload.currency,
        totalCurrentAmount: entry.amount,
        components: [{ component: entry.component, currentAmount: entry.amount, currency: entry.currency }],
        history: [entry]
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(entry)
      });
      return;
    }

    if (section === 'coverage') {
      state.coverageBody = payload;
      state.coverage = {
        id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d34',
        tenantId: CLAIM.tenantId,
        claimId: CLAIM.id,
        position: payload.position,
        basis: payload.basis,
        policyProvisions: payload.policyProvisions,
        allocationMethod: payload.allocationMethod,
        allocationPct: payload.allocationPct,
        decisionDate: payload.decisionDate,
        reviewerPartyId: payload.reviewerPartyId,
        status: 'FINAL',
        version: 1,
        createdAt: '2026-03-18T09:10:00Z',
        updatedAt: '2026-03-18T09:10:00Z'
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(state.coverage)
      });
      return;
    }

    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
}

test('posts a reserve change and shows the derived reserve history', async ({ page }) => {
  const state = {
    requests: [],
    reserveBody: null,
    reserveSummary: {
      claimId: CLAIM.id,
      currency: 'USD',
      totalCurrentAmount: '0.0000',
      components: [],
      history: []
    }
  };
  await page.route('**/api/v1/claims', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([CLAIM]) });
  });
  await detailRoute(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: /CLM-2026-0000001/ }).click();
  await page.getByRole('tab', { name: 'Reserve History', exact: true }).click();

  await expect(page.getByTestId('current-reserve')).toHaveText(/0\.00/);

  await page.getByLabel('Reserve change amount').fill('100000');
  await page.getByLabel('Reserve authority').fill('Chief Claims Officer');
  await page.getByRole('button', { name: 'Post reserve change' }).click();

  await expect(page.getByTestId('current-reserve')).toHaveText(/100,000\.00/);
  await expect(page.getByText('INDEMNITY', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('INITIAL', { exact: true })).toBeVisible();

  expect(state.reserveBody.amount).toBe('100000');
  expect(typeof state.reserveBody.amount).toBe('string');
  expect(state.reserveBody.reasonCode).toBe('INITIAL');
  expect(state.reserveBody.expectedVersion).toBe(0);
  expect(state.requests.filter((entry) => entry.path.endsWith('/reserves')).length).toBeGreaterThan(1);
  expect(state.requests.every((entry) => entry.book === 'DIRECT')).toBeTruthy();
});

test('records a coverage decision in the workbench', async ({ page }) => {
  const state = { requests: [], coverage: null, coverageBody: null };
  await page.route('**/api/v1/claims', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([CLAIM]) });
  });
  await detailRoute(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: /CLM-2026-0000001/ }).click();
  await page.getByRole('tab', { name: 'Coverage', exact: true }).click();

  await expect(page.getByTestId('coverage-empty')).toBeVisible();

  await page.getByLabel('Coverage basis').fill('Policy year 2024 responds to the continuous trigger');
  await page.getByLabel('Policy provisions').fill('Coverage A; occurrence trigger');
  await page.getByRole('button', { name: 'Record coverage decision' }).click();

  await expect(page.getByTestId('coverage-position')).toHaveText('COVERED');
  await expect(page.getByTestId('coverage-basis')).toHaveText(
    'Policy year 2024 responds to the continuous trigger'
  );
  expect(state.coverageBody.position).toBe('COVERED');
  expect(state.coverageBody.basis).toContain('continuous trigger');
  expect(state.requests.every((entry) => entry.book === 'DIRECT')).toBeTruthy();
});

test('lists injury, exposure, litigation, settlement, recovery, and lien sections', async ({ page }) => {
  const state = { requests: [] };
  await page.route('**/api/v1/claims', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([CLAIM]) });
  });
  await detailRoute(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: /CLM-2026-0000001/ }).click();

  for (const label of [
    'Overview',
    'Injuries & Exposures',
    'Reserve History',
    'Coverage',
    'Litigation',
    'Settlements',
    'Recovery & Liens'
  ]) {
    await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole('tab', { name: 'Litigation', exact: true }).click();
  await expect(page.getByText('No litigation matter.')).toBeVisible();
  await page.getByRole('tab', { name: 'Settlements', exact: true }).click();
  await expect(page.getByText('No settlement.')).toBeVisible();
  await page.getByRole('tab', { name: 'Recovery & Liens', exact: true }).click();
  await expect(page.getByText('No recovery.')).toBeVisible();
  await expect(page.getByText('No lien.')).toBeVisible();
});

test('closes a claim from the record header and keeps the DIRECT book wall', async ({ page }) => {
  let claim = { ...CLAIM };
  let closeBody = null;
  let closeBook = null;

  await page.route('**/api/v1/claims', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([claim]) });
  });
  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/close')) {
      closeBody = request.postDataJSON();
      closeBook = request.headers()['x-eia-book'];
      claim = { ...claim, status: 'CLOSED', version: 1, currentReserveAmount: '0.0000' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(claim)
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: 'Close claim' }).click();

  await expect(page.getByRole('button', { name: 'Closed', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(`${CLAIM.claimNumber} closed`);
  expect(closeBody.expectedVersion).toBe(0);
  expect(closeBook).toBe('DIRECT');
});

