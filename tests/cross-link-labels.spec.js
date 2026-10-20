import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const CLAIM = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21',
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000001',
  policyId: POLICY_ID,
  claimantPartyId: PARTY_ID,
  claimType: 'BODILY_INJURY',
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '125000.0000',
  currentReserveAmount: '125000.0000',
  reserveCurrency: 'USD',
  version: 0
};

const POLICY = {
  id: POLICY_ID,
  tenantId: TENANT,
  policyNumber: 'POL-2026-0000001',
  productCode: 'CGL',
  status: 'ACTIVE'
};

const PARTY = {
  id: PARTY_ID,
  tenantId: TENANT,
  partyNumber: 'PTY-000000001',
  displayName: 'Acme Manufacturing',
  partyType: 'ORGANIZATION',
  status: 'ACTIVE'
};

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockClaims(page, claim) {
  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, [claim]);
      return;
    }
    await json(route, 200, {});
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    await json(route, 200, []);
  });

  await page.route('**/api/v1/cessions/search**', async (route) => {
    await json(route, 200, { query: '', limit: 5, items: [] });
  });
}

/**
 * Mocks the policy and party detail lookups and records their request headers.
 * `policyStatus`/`partyStatus` simulate a lookup failure (404 by default in the
 * fallback test). `policyGate` keeps the policy response pending so a test can
 * prove that the claim record does not wait for it.
 */
async function mockRelated(page, { policyStatus = 200, partyStatus = 200, requests = [], policyGate = null } = {}) {
  await page.route('**/api/v1/policies/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    requests.push({
      kind: 'policy',
      path: url.pathname,
      tenant: headers['x-eia-tenant'],
      book: headers['x-eia-book']
    });
    if (policyGate) await policyGate;
    if (policyStatus !== 200) {
      await json(route, policyStatus, { code: 'NOT_FOUND', message: 'Policy not found' });
      return;
    }
    await json(route, 200, POLICY);
  });

  await page.route('**/api/v1/parties/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    requests.push({
      kind: 'party',
      path: url.pathname,
      tenant: headers['x-eia-tenant'],
      book: headers['x-eia-book']
    });
    if (partyStatus !== 200) {
      await json(route, partyStatus, { code: 'NOT_FOUND', message: 'Party not found' });
      return;
    }
    await json(route, 200, PARTY);
  });
}

test('enriches policy and claimant cross-links with the same labels everywhere', async ({ page }) => {
  const requests = [];
  await mockClaims(page, CLAIM);
  await mockRelated(page, { requests });

  await page.goto('/');

  const policyLink = page.getByTestId('overview-policy-link');
  await expect(policyLink).toHaveText('POL-2026-0000001 · CGL');
  await expect(policyLink).toHaveAttribute('href', `/policy?record=${POLICY_ID}`);

  const claimantLink = page.getByTestId('overview-claimant-link');
  await expect(claimantLink).toHaveText('Acme Manufacturing · PTY-000000001');
  await expect(claimantLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  await expect(page.getByTestId('record-subtitle')).toContainText('Policy POL-2026-0000001 · CGL');
  await expect(page.getByTestId('record-subtitle')).toContainText(
    'Claimant Acme Manufacturing · PTY-000000001'
  );
  await expect(page.getByTestId('header-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByTestId('header-claimant-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY_ID}`
  );

  await expect(page.getByTestId('why-policy-link')).toHaveText('POL-2026-0000001 · CGL');
  await expect(page.getByTestId('why-claimant-link')).toHaveText('Acme Manufacturing · PTY-000000001');

  const relatedPolicy = page.getByTestId('related-policy-link');
  await expect(relatedPolicy).toContainText('POL-2026-0000001 · CGL');
  await expect(relatedPolicy).toHaveAttribute('href', `/policy?record=${POLICY_ID}`);

  expect(requests.filter((entry) => entry.kind === 'policy')).toEqual([
    {
      kind: 'policy',
      path: `/api/v1/policies/${POLICY_ID}`,
      tenant: TENANT,
      book: 'DIRECT'
    }
  ]);
  expect(requests.filter((entry) => entry.kind === 'party')).toEqual([
    {
      kind: 'party',
      path: `/api/v1/parties/${PARTY_ID}`,
      tenant: TENANT,
      book: undefined
    }
  ]);
});

test('keeps the claim rendered and the UUID fallback while labels load', async ({ page }) => {
  let releasePolicy;
  const policyGate = new Promise((resolve) => {
    releasePolicy = resolve;
  });
  await mockClaims(page, CLAIM);
  await mockRelated(page, { policyGate });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  const policyLink = page.getByTestId('overview-policy-link');
  await expect(policyLink).toHaveAttribute('href', `/policy?record=${POLICY_ID}`);
  await expect(policyLink).toContainText('22222222…');

  releasePolicy();
  await expect(policyLink).toHaveText('POL-2026-0000001 · CGL');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
});

test('falls back to the short UUID when the policy or party lookup returns 404', async ({ page }) => {
  await mockClaims(page, CLAIM);
  await mockRelated(page, { policyStatus: 404, partyStatus: 404 });

  await page.goto('/');

  const policyLink = page.getByTestId('overview-policy-link');
  const claimantLink = page.getByTestId('overview-claimant-link');

  await expect(policyLink).toHaveText('22222222…');
  await expect(claimantLink).toHaveText('33333333…');
  await expect(policyLink).toHaveAttribute('href', `/policy?record=${POLICY_ID}`);
  await expect(claimantLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  await expect(page.getByTestId('record-subtitle')).toContainText('Policy 22222222…');
  await expect(page.getByTestId('record-subtitle')).toContainText('Claimant 33333333…');
  await expect(page.getByTestId('why-policy-link')).toHaveText('22222222…');
  await expect(page.getByTestId('why-claimant-link')).toHaveText('33333333…');
  await expect(page.getByTestId('related-policy-link')).toContainText('22222222…');
});

test('does not issue policy or party detail lookups for an assumed record', async ({ page }) => {
  const assumed = {
    ...CLAIM,
    id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d77',
    businessBook: 'ASSUMED',
    claimNumber: 'CLM-2026-0000777'
  };
  const requests = [];
  await mockClaims(page, assumed);
  await mockRelated(page, { requests });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: assumed.claimNumber })).toBeVisible();
  await expect(page.getByTestId('overview-policy-link')).toHaveText('22222222…');
  await expect(page.getByTestId('overview-claimant-link')).toHaveText('33333333…');
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});
