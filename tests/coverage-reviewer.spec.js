import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const CLAIMANT_PARTY_ID = '33333333-3333-7333-8333-333333333333';
const REVIEWER_PARTY_ID = '44444444-4444-7444-8444-444444444444';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000401',
  policyId: POLICY_ID,
  claimantPartyId: CLAIMANT_PARTY_ID,
  claimType: 'BODILY_INJURY',
  status: 'OPEN',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '125000.0000',
  currentReserveAmount: '125000.0000',
  reserveCurrency: 'USD',
  settlementAuthorityAmount: '500000.0000',
  settlementAuthorityCurrency: 'USD',
  version: 2,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-20T09:00:00Z'
};

const REVIEWER_ITEM = {
  id: REVIEWER_PARTY_ID,
  type: 'PARTY',
  label: 'PTY-2026-0088',
  secondary: 'Dana Whitfield · REVIEWER',
  status: 'ACTIVE',
  href: `/party?record=${REVIEWER_PARTY_ID}`
};

const REVIEWER_DETAIL = {
  id: REVIEWER_PARTY_ID,
  tenantId: TENANT,
  displayName: 'Dana Whitfield',
  partyNumber: 'PTY-2026-0088',
  partyType: 'PERSON',
  status: 'ACTIVE'
};

const CLAIMANT_DETAIL = {
  id: CLAIMANT_PARTY_ID,
  tenantId: TENANT,
  displayName: 'Meridian Manufacturing',
  partyNumber: 'PTY-2026-0001',
  partyType: 'ORGANIZATION',
  status: 'ACTIVE'
};

function makeDecision(overrides = {}) {
  return {
    id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    tenantId: TENANT,
    claimId: CLAIM_ID,
    position: 'COVERED',
    basis: 'Occurrence within the policy period.',
    policyProvisions: 'Coverage A; occurrence trigger',
    allocationMethod: 'PRO_RATA_TIME',
    allocationPct: '1.000000',
    decisionDate: '2026-04-01',
    reviewerPartyId: REVIEWER_PARTY_ID,
    status: 'FINAL',
    version: 1,
    createdAt: '2026-04-01T09:00:00Z',
    updatedAt: '2026-04-01T09:00:00Z',
    ...overrides
  };
}

async function json(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function installMocks(page, options = {}) {
  const state = {
    coverage: options.coverage ? { ...options.coverage } : null,
    coveragePosts: [],
    searchRequests: [],
    partyRequests: []
  };

  // Containment for the resources this screen does not exercise.
  await page.route('**/api/v1/**', async (route) => {
    await json(route, []);
  });

  await page.route('**/api/v1/directory', async (route) => {
    await json(route, { people: [], teams: [] });
  });

  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, [CLAIM]);
      return;
    }
    await json(route, {});
  });

  await page.route('**/api/v1/policies/**', async (route) => {
    await json(route, {
      id: POLICY_ID,
      policyNumber: 'POL-2026-0001',
      productCode: 'GL'
    });
  });

  await page.route('**/api/v1/parties/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();

    if (url.pathname === '/api/v1/parties/search') {
      state.searchRequests.push({
        query: url.searchParams.get('q'),
        limit: url.searchParams.get('limit'),
        tenant: headers['x-eia-tenant'],
        book: headers['x-eia-book']
      });
      await json(route, {
        query: url.searchParams.get('q'),
        limit: 8,
        items: [REVIEWER_ITEM]
      });
      return;
    }

    const partyId = url.pathname.split('/').pop();
    state.partyRequests.push({
      path: url.pathname,
      tenant: headers['x-eia-tenant'],
      book: headers['x-eia-book']
    });
    await json(route, partyId === REVIEWER_PARTY_ID ? REVIEWER_DETAIL : CLAIMANT_DETAIL);
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === 'GET' && path.endsWith('/coverage')) {
      if (!state.coverage) {
        await json(route, { code: 'NOT_FOUND', message: 'No coverage decision recorded' }, 404);
        return;
      }
      await json(route, state.coverage);
      return;
    }

    if (request.method() === 'POST' && path.endsWith('/coverage')) {
      const body = request.postDataJSON();
      state.coveragePosts.push({ body, headers: request.headers() });
      state.coverage = makeDecision(body);
      await json(route, state.coverage, 201);
      return;
    }

    if (request.method() === 'GET' && path.endsWith('/reserves')) {
      await json(route, {
        totalCurrentAmount: '0.0000',
        currency: 'USD',
        components: [],
        history: []
      });
      return;
    }

    await json(route, []);
  });

  return state;
}

async function openCoverage(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(CLAIM.claimNumber) }).click();
  await page.getByRole('tab', { name: 'Coverage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Record a coverage decision' })).toBeVisible();
}

test('searches the party register, links the selection, and posts only the reviewer party id', async ({
  page
}) => {
  const state = await installMocks(page);
  await openCoverage(page);

  await page.getByLabel('Coverage basis').fill('Policy year 2024 responds to the continuous trigger');
  await page.getByPlaceholder('Search reviewer party number or name…').fill('Whitfield');
  await expect(page.getByRole('button', { name: /PTY-2026-0088/ })).toBeVisible();
  await page.getByRole('button', { name: /PTY-2026-0088/ }).click();

  const pickerLink = page.getByTestId('coverage-reviewer-picker-link');
  await expect(pickerLink).toHaveText('PTY-2026-0088');
  await expect(pickerLink).toHaveAttribute('href', `/party?record=${REVIEWER_PARTY_ID}`);
  expect(state.searchRequests).toEqual([
    { query: 'Whitfield', limit: '8', tenant: TENANT, book: undefined }
  ]);

  await page.getByRole('button', { name: 'Record coverage decision' }).click();

  await expect(page.getByTestId('coverage-position')).toHaveText('COVERED');
  const reviewerLink = page.getByTestId('coverage-reviewer-link');
  await expect(reviewerLink).toHaveText('PTY-2026-0088');
  await expect(reviewerLink).toHaveAttribute('href', `/party?record=${REVIEWER_PARTY_ID}`);

  expect(state.coveragePosts).toHaveLength(1);
  expect(state.coveragePosts[0].body).toMatchObject({
    position: 'COVERED',
    basis: 'Policy year 2024 responds to the continuous trigger',
    reviewerPartyId: REVIEWER_PARTY_ID
  });
  expect(state.coveragePosts[0].body).not.toHaveProperty('reviewerPartyLabel');
  expect(state.coveragePosts[0].headers['x-eia-book']).toBe('DIRECT');
  expect(state.coveragePosts[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('hydrates the reviewer id, label, and party link from an existing decision', async ({ page }) => {
  const state = await installMocks(page, { coverage: makeDecision() });
  await openCoverage(page);

  await expect(page.getByTestId('coverage-position')).toHaveText('COVERED');
  const reviewerLink = page.getByTestId('coverage-reviewer-link');
  await expect(reviewerLink).toHaveText('Dana Whitfield · PTY-2026-0088');
  await expect(reviewerLink).toHaveAttribute('href', `/party?record=${REVIEWER_PARTY_ID}`);

  // The picker hydrates to the saved party instead of starting blank.
  await expect(page.getByPlaceholder('Search reviewer party number or name…')).toHaveCount(0);
  await expect(page.getByTestId('coverage-reviewer-picker-link')).toHaveText(
    'Dana Whitfield · PTY-2026-0088'
  );
  expect(state.partyRequests).toContainEqual({
    path: `/api/v1/parties/${REVIEWER_PARTY_ID}`,
    tenant: TENANT,
    book: undefined
  });

  await expect(page.getByTestId('coverage-context')).toContainText(
    'The reviewer is a party record.'
  );

  // Recording a replacement keeps the hydrated reviewer without a new search.
  await page.getByLabel('Coverage basis').fill('Coverage confirmed after the second review.');
  await page.getByRole('button', { name: 'Record coverage decision' }).click();
  expect(state.coveragePosts).toHaveLength(1);
  expect(state.coveragePosts[0].body.reviewerPartyId).toBe(REVIEWER_PARTY_ID);
  expect(state.searchRequests).toEqual([]);
});

test('requires a reviewer party before recording the decision', async ({ page }) => {
  const state = await installMocks(page);
  await openCoverage(page);

  await page.getByLabel('Coverage basis').fill('Policy year 2024 responds to the continuous trigger');
  await page.getByRole('button', { name: 'Record coverage decision' }).click();

  await expect(page.getByTestId('coverage-form-error')).toContainText(
    'Select the reviewer party from the shared party records.'
  );
  expect(state.coveragePosts).toEqual([]);
});
