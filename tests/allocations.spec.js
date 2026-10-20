import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d91';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';
const LIMIT_GL = '66666666-6666-7666-8666-666666666661';
const LIMIT_PROPERTY = '66666666-6666-7666-8666-666666666662';
const COVERAGE_GL = '77777777-7777-7777-8777-777777777771';
const COVERAGE_PROPERTY = '77777777-7777-7777-8777-777777777772';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000301',
  policyId: POLICY_ID,
  claimantPartyId: PARTY_ID,
  claimType: 'MASS_TORT',
  status: 'OPEN',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '500000.0000',
  currentReserveAmount: '500000.0000',
  reserveCurrency: 'USD',
  version: 3,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-24T09:00:00Z'
};

/** `ItemPage<CoverageViewDto>` items returned by the Policy coverages read. */
const COVERAGE_VIEWS = [
  {
    coverage: {
      id: COVERAGE_GL,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageCode: 'GL',
      coverageName: 'General Liability',
      coveragePart: 'LIABILITY',
      status: 'ACTIVE',
      sequence: 1
    },
    limit: {
      id: LIMIT_GL,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageId: COVERAGE_GL,
      perOccurrenceAmount: '1000000.0000',
      aggregateAmount: '5000000.0000',
      currency: 'USD',
      erosionBasis: 'PAID_PLUS_RESERVED',
      sequence: 1
    },
    state: {
      id: '88888888-8888-8888-8888-888888888881',
      tenantId: TENANT,
      policyId: POLICY_ID,
      limitId: LIMIT_GL,
      originalAmount: '5000000.0000',
      paidAmount: '100000.0000',
      reservedAmount: '200000.0000',
      incurredAmount: '300000.0000',
      recoveredAmount: '0.0000',
      remainingAmount: '4700000.0000',
      erodedPct: '0.060000',
      sourceVersion: 3
    }
  },
  {
    coverage: {
      id: COVERAGE_PROPERTY,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageCode: 'PROPERTY',
      coverageName: 'Commercial Property',
      coveragePart: 'PROPERTY',
      status: 'ACTIVE',
      sequence: 2
    },
    limit: {
      id: LIMIT_PROPERTY,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageId: COVERAGE_PROPERTY,
      perOccurrenceAmount: '2000000.0000',
      aggregateAmount: '2000000.0000',
      currency: 'USD',
      erosionBasis: 'PAID',
      sequence: 2
    },
    state: {
      id: '88888888-8888-8888-8888-888888888882',
      tenantId: TENANT,
      policyId: POLICY_ID,
      limitId: LIMIT_PROPERTY,
      originalAmount: '2000000.0000',
      paidAmount: '0.0000',
      reservedAmount: '0.0000',
      incurredAmount: '0.0000',
      recoveredAmount: '0.0000',
      remainingAmount: '2000000.0000',
      erodedPct: '0.000000',
      sourceVersion: 1
    }
  }
];

function makeAllocation({
  allocationId,
  policyYear,
  layer,
  allocationPct,
  allocatedAmount,
  createdAt = '2026-03-20T10:00:00Z',
  limitId = null,
  erosionStatus = 'NOT_POSTED',
  erosionMessage = null,
  erosionPostedAt = null
}) {
  return {
    allocationId,
    claimId: CLAIM_ID,
    policyId: POLICY_ID,
    policyYear,
    layer,
    allocationPct,
    allocatedAmount,
    limitId,
    erosionStatus,
    erosionMessage,
    erosionPostedAt,
    createdAt
  };
}

const PRIMARY_2023 = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e01',
  policyYear: 2023,
  layer: 'PRIMARY',
  allocationPct: '0.250000',
  allocatedAmount: '100000.0000'
});

const EXCESS_2024 = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e02',
  policyYear: 2024,
  layer: 'EXCESS_1',
  allocationPct: '0.250000',
  allocatedAmount: '150000.0000'
});

const SIXTY_PERCENT = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e03',
  policyYear: 2024,
  layer: 'PRIMARY',
  allocationPct: '0.600000',
  allocatedAmount: '300000.0000'
});

const THIRTY_PERCENT = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e05',
  policyYear: 2024,
  layer: 'PRIMARY',
  allocationPct: '0.300000',
  allocatedAmount: '150000.0000'
});

const SEVENTY_PERCENT = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e04',
  policyYear: 2025,
  layer: 'EXCESS_1',
  allocationPct: '0.700000',
  allocatedAmount: '350000.0000'
});

const FAILED_EROSION = makeAllocation({
  allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e06',
  policyYear: 2024,
  layer: 'EXCESS_1',
  allocationPct: '0.200000',
  allocatedAmount: '100000.0000',
  limitId: LIMIT_GL,
  erosionStatus: 'FAILED',
  erosionMessage: 'Policy erosion service unavailable.'
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function fulfillProblem(route, status, detail, code = 'VALIDATION_ERROR') {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'about:blank',
      title: status === 409 ? 'Conflict' : status === 503 ? 'Service Unavailable' : 'Bad Request',
      status,
      code,
      detail
    })
  });
}

function summaryBody(allocations) {
  const totalPct = allocations.reduce((total, row) => total + Number(row.allocationPct), 0);
  const totalAmount = allocations.reduce((total, row) => total + Number(row.allocatedAmount), 0);
  return { items: allocations, totalPct: totalPct.toFixed(6), totalAmount: totalAmount.toFixed(4) };
}

/**
 * Mocks the claim queue, the claim sub-resources the workbench preloads, the
 * allocation list/create/erosion routes, the policy coverage/limit read, and
 * the policy/party label lookups.
 */
async function installMocks(page, options = {}) {
  const state = {
    allocations: (options.allocations || []).map((row) => ({ ...row })),
    requests: [],
    policyRequests: [],
    createBodies: [],
    retryBodies: [],
    listGate: options.listGate || null,
    listStatus: options.listStatus || 200,
    listDetail: options.listDetail || 'The allocation ledger is temporarily unavailable.',
    postStatus: options.postStatus || null,
    postDetail: options.postDetail || 'The allocation was rejected.',
    onPost: options.onPost || null,
    postErosionStatus: options.postErosionStatus || 'POSTED',
    postErosionMessage: options.postErosionMessage || 'Policy limit erosion failed.',
    coverages: (options.coverages || []).map((view) => ({ ...view })),
    coverageGate: options.coverageGate || null,
    coverageStatus: options.coverageStatus || 200,
    coverageDetail:
      options.coverageDetail || 'Policy coverages and limits are temporarily unavailable.',
    retryStatus: options.retryStatus || 200,
    retryDetail: options.retryDetail || 'The erosion retry was rejected.'
  };

  await page.route('**/api/v1/directory', async (route) => {
    await fulfillJson(route, { people: [], teams: [] });
  });

  await page.route('**/api/v1/claims', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await fulfillJson(route, [CLAIM]);
      return;
    }
    await fulfillJson(route, {});
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const rest = url.pathname.slice('/api/v1/claims/'.length);
    const [claimId, section, childId, action] = rest.split('/');

    state.requests.push({
      method,
      path: url.pathname,
      book: request.headers()['x-eia-book'],
      tenant: request.headers()['x-eia-tenant']
    });

    if (method === 'GET' && section === 'allocations' && !childId) {
      if (state.listGate) await state.listGate;
      if (state.listStatus !== 200) {
        await fulfillProblem(route, state.listStatus, state.listDetail);
        return;
      }
      await fulfillJson(route, summaryBody(state.allocations));
      return;
    }

    if (method === 'POST' && section === 'allocations' && childId && action === 'erosion') {
      state.retryBodies.push({ allocationId: childId });
      if (state.retryStatus !== 200) {
        await fulfillProblem(route, state.retryStatus, state.retryDetail, 'DEPENDENCY_UNAVAILABLE');
        return;
      }
      const index = state.allocations.findIndex((row) => row.allocationId === childId);
      if (index < 0) {
        await fulfillProblem(route, 404, 'Allocation not found.', 'NOT_FOUND');
        return;
      }
      const updated = {
        ...state.allocations[index],
        erosionStatus: 'POSTED',
        erosionMessage: null,
        erosionPostedAt: '2026-10-20T12:05:00Z'
      };
      state.allocations[index] = updated;
      await fulfillJson(route, updated);
      return;
    }

    if (method === 'POST' && section === 'allocations' && !childId) {
      const body = request.postDataJSON();
      state.createBodies.push(body);
      if (state.postStatus) {
        if (state.onPost) state.onPost();
        await fulfillProblem(route, state.postStatus, state.postDetail, 'ALLOCATION_EXCEEDS_100');
        return;
      }
      const erosionStatus = body.limitId ? state.postErosionStatus : 'NOT_POSTED';
      const created = makeAllocation({
        allocationId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e99',
        policyYear: Number(body.policyYear),
        layer: body.layer,
        allocationPct: Number(body.allocationPct).toFixed(6),
        allocatedAmount: Number(body.allocatedAmount).toFixed(4),
        createdAt: '2026-10-20T12:00:00Z',
        limitId: body.limitId || null,
        erosionStatus,
        erosionMessage: erosionStatus === 'FAILED' ? state.postErosionMessage : null,
        erosionPostedAt: erosionStatus === 'POSTED' ? '2026-10-20T12:00:00Z' : null
      });
      state.allocations = [...state.allocations, created];
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === 'GET' && section === 'coverage') {
      await fulfillProblem(route, 404, 'No coverage decision recorded', 'NOT_FOUND');
      return;
    }

    if (method === 'GET' && section === 'reserves') {
      await fulfillJson(route, {
        claimId,
        currency: 'USD',
        totalCurrentAmount: '0.0000',
        components: [],
        history: []
      });
      return;
    }

    if (method === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route(/\/api\/v1\/policies\/[^/]+\/coverages(\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.policyRequests.push({
      method: request.method(),
      path: url.pathname,
      search: url.search,
      book: request.headers()['x-eia-book'],
      tenant: request.headers()['x-eia-tenant']
    });
    if (state.coverageGate) await state.coverageGate;
    if (state.coverageStatus !== 200) {
      await fulfillProblem(route, state.coverageStatus, state.coverageDetail, 'DEPENDENCY_UNAVAILABLE');
      return;
    }
    await fulfillJson(route, {
      items: state.coverages,
      page: 0,
      size: 100,
      total: state.coverages.length
    });
  });

  await page.route(/\/api\/v1\/policies\/[^/]+$/, async (route) => {
    await fulfillJson(route, {
      id: POLICY_ID,
      policyNumber: 'POL-2026-0001',
      productCode: 'GL'
    });
  });

  await page.route(/\/api\/v1\/parties\/[^/]+$/, async (route) => {
    await fulfillJson(route, {
      id: PARTY_ID,
      displayName: 'Meridian Manufacturing',
      partyNumber: 'PTY-2026-0001'
    });
  });

  return state;
}

async function openAllocations(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Allocations', exact: true }).click();
}

function allocationRow(page, year) {
  return page.locator('tbody tr', { hasText: String(year) });
}

function policyLimitSelect(page) {
  return page.getByRole('combobox', { name: 'Policy limit', exact: true });
}

async function fillAllocation(page, { year = '2025', layer = 'EXCESS_1', percent = '10', amount = '50000' } = {}) {
  await page.getByRole('spinbutton', { name: 'Policy year', exact: true }).fill(year);
  await page.getByRole('textbox', { name: 'Layer', exact: true }).fill(layer);
  await page.getByRole('spinbutton', { name: 'Allocation percent', exact: true }).fill(percent);
  await page.getByRole('spinbutton', { name: 'Allocated amount', exact: true }).fill(amount);
}

test('lists allocations with their summary, table columns, and policy links', async ({ page }) => {
  const state = await installMocks(page, { allocations: [PRIMARY_2023, EXCESS_2024] });
  await openAllocations(page);

  const labels = await page.getByRole('tab').allTextContents();
  expect(labels.indexOf('Coverage')).toBeLessThan(labels.indexOf('Allocations'));
  expect(labels.indexOf('Allocations')).toBeLessThan(labels.indexOf('Litigation'));

  await expect(page.getByTestId('summary-allocated-amount')).toHaveText('USD 250,000.00');
  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('50.00%');
  await expect(page.getByTestId('summary-unallocated')).toHaveText('USD 250,000.00');
  await expect(page.getByTestId('summary-allocation-count')).toHaveText('2');
  await expect(page.getByTestId('allocation-remaining-percent')).toContainText('50.00% remaining');

  const row2023 = allocationRow(page, 2023);
  await expect(row2023).toContainText('PRIMARY');
  await expect(row2023).toContainText('25.00%');
  await expect(row2023).toContainText('USD 100,000.00');
  await expect(row2023.getByTestId('allocation-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(row2023.getByTestId('allocation-policy-link')).toContainText('POL-2026-0001');

  const row2024 = allocationRow(page, 2024);
  await expect(row2024).toContainText('EXCESS_1');
  await expect(row2024).toContainText('USD 150,000.00');

  await expect(page.getByTestId('allocation-policy')).toContainText('POL-2026-0001');
  await expect(page.getByRole('link', { name: 'POL-2026-0001 · GL' }).first()).toBeVisible();

  const allocationRequests = state.requests.filter((entry) => entry.path.endsWith('/allocations'));
  expect(allocationRequests.length).toBeGreaterThan(0);
  expect(
    allocationRequests.every((entry) => entry.book === 'DIRECT' && entry.tenant === TENANT)
  ).toBeTruthy();
});

test('creates an allocation from a 0-100 percent input and sends a fraction', async ({ page }) => {
  const state = await installMocks(page, { allocations: [PRIMARY_2023] });
  await openAllocations(page);

  await expect(page.getByTestId('allocation-remaining-percent')).toContainText('75.00% remaining');

  await fillAllocation(page, { year: '2025', percent: '75', amount: '250000.00' });
  await expect(page.getByTestId('allocation-remaining-percent')).toContainText('0.00% after this entry');
  await page.getByRole('button', { name: 'Record allocation' }).click();

  await expect(page.getByTestId('allocations-status')).toContainText('policy year 2025');
  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).toEqual({
    policyId: POLICY_ID,
    policyYear: 2025,
    layer: 'EXCESS_1',
    allocationPct: 0.75,
    allocatedAmount: '250000.00'
  });

  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('100.00%');
  await expect(page.getByTestId('summary-allocated-amount')).toHaveText('USD 350,000.00');
  await expect(page.getByTestId('summary-unallocated')).toHaveText('USD 150,000.00');
  await expect(page.getByTestId('summary-allocation-count')).toHaveText('2');
  await expect(allocationRow(page, 2025)).toContainText('EXCESS_1');
  await expect(allocationRow(page, 2025)).toContainText('75.00%');
  await expect(allocationRow(page, 2025)).toContainText('USD 250,000.00');

  const createdPost = state.requests.find(
    (entry) => entry.method === 'POST' && entry.path === `/api/v1/claims/${CLAIM_ID}/allocations`
  );
  expect(createdPost.book).toBe('DIRECT');
  expect(createdPost.tenant).toBe(TENANT);
});

test('loads policy limits when the tab opens and offers flattened coverage, limit, and remaining options', async ({
  page
}) => {
  const state = await installMocks(page, {
    allocations: [PRIMARY_2023],
    coverages: COVERAGE_VIEWS
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  // Limits are an Allocations-tab concern, so selecting a claim alone must not read them.
  expect(state.policyRequests).toHaveLength(0);

  await page.getByRole('tab', { name: 'Allocations', exact: true }).click();

  const limitSelect = policyLimitSelect(page);
  await expect(limitSelect).toBeVisible();
  await expect(page.getByTestId('allocation-limit-hint')).toContainText(
    'no policy-limit erosion is posted'
  );

  const options = limitSelect.locator('option');
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveText('No policy limit (no erosion)');
  await expect(options.nth(1)).toContainText('GL · General Liability');
  await expect(options.nth(1)).toContainText('Limit USD 5,000,000.00');
  await expect(options.nth(1)).toContainText('Remaining USD 4,700,000.00');
  await expect(options.nth(2)).toContainText('PROPERTY · Commercial Property');
  await expect(options.nth(2)).toContainText('Remaining USD 2,000,000.00');

  expect(state.policyRequests).toHaveLength(1);
  expect(state.policyRequests[0].method).toBe('GET');
  expect(state.policyRequests[0].path).toBe(`/api/v1/policies/${POLICY_ID}/coverages`);
  expect(state.policyRequests[0].book).toBe('DIRECT');
  expect(state.policyRequests[0].tenant).toBe(TENANT);

  await limitSelect.selectOption(LIMIT_GL);
  const detail = page.getByTestId('allocation-limit-detail');
  await expect(detail).toContainText('Coverage GL · General Liability');
  await expect(detail).toContainText('Limit USD 5,000,000.00');
  await expect(detail).toContainText('Remaining USD 4,700,000.00');
});

test('sends the selected limitId and shows posted erosion on the created allocation', async ({
  page
}) => {
  const state = await installMocks(page, {
    allocations: [PRIMARY_2023],
    coverages: COVERAGE_VIEWS
  });
  await openAllocations(page);

  await expect(policyLimitSelect(page).locator('option')).toHaveCount(3);
  await policyLimitSelect(page).selectOption(LIMIT_GL);
  await fillAllocation(page, { year: '2025', percent: '10', amount: '50000' });
  await page.getByRole('button', { name: 'Record allocation' }).click();

  await expect(page.getByTestId('allocations-status')).toContainText(
    'Policy-limit erosion posted.'
  );
  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).toEqual({
    policyId: POLICY_ID,
    policyYear: 2025,
    layer: 'EXCESS_1',
    allocationPct: 0.1,
    allocatedAmount: '50000',
    limitId: LIMIT_GL
  });

  const row = allocationRow(page, 2025);
  await expect(row.getByTestId('allocation-erosion-badge')).toHaveText('Posted');
  await expect(row.getByTestId('allocation-limit')).toContainText('GL · General Liability');
  await expect(row.getByTestId('allocation-limit')).toContainText('USD 5,000,000.00');
  await expect(row.getByTestId('allocation-erosion-posted-at')).toBeVisible();
});

test('shows a failed erosion badge, its message, and retries the erosion post', async ({ page }) => {
  const state = await installMocks(page, {
    allocations: [FAILED_EROSION],
    coverages: COVERAGE_VIEWS
  });
  await openAllocations(page);

  const row = allocationRow(page, 2024);
  await expect(row.getByTestId('allocation-erosion-badge')).toHaveText('Failed');
  await expect(row.getByTestId('allocation-erosion-message')).toContainText(
    'Policy erosion service unavailable.'
  );
  await expect(row.getByTestId('allocation-limit')).toContainText('GL · General Liability');
  await expect(row.getByTestId('allocation-erosion-posted-at')).toHaveCount(0);

  await row.getByRole('button', { name: 'Retry erosion' }).click();

  await expect(row.getByTestId('allocation-erosion-badge')).toHaveText('Posted');
  await expect(row.getByTestId('allocation-erosion-message')).toHaveCount(0);
  await expect(row.getByTestId('allocation-erosion-retry')).toHaveCount(0);
  await expect(row.getByTestId('allocation-erosion-posted-at')).toBeVisible();
  await expect(page.getByTestId('allocations-status')).toContainText('Erosion posted to the policy limit');

  expect(state.retryBodies).toEqual([{ allocationId: FAILED_EROSION.allocationId }]);
  const retryRequest = state.requests.find(
    (entry) =>
      entry.method === 'POST' &&
      entry.path ===
        `/api/v1/claims/${CLAIM_ID}/allocations/${FAILED_EROSION.allocationId}/erosion`
  );
  expect(retryRequest.book).toBe('DIRECT');
  expect(retryRequest.tenant).toBe(TENANT);
});

test('records an allocation without a limit and explains that no erosion is posted', async ({
  page
}) => {
  const state = await installMocks(page, {
    allocations: [],
    coverages: COVERAGE_VIEWS
  });
  await openAllocations(page);

  await expect(policyLimitSelect(page)).toHaveValue('');
  await fillAllocation(page, { year: '2025', layer: 'PRIMARY', percent: '20', amount: '100000' });
  await page.getByRole('button', { name: 'Record allocation' }).click();

  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).toEqual({
    policyId: POLICY_ID,
    policyYear: 2025,
    layer: 'PRIMARY',
    allocationPct: 0.2,
    allocatedAmount: '100000'
  });
  expect(state.createBodies[0]).not.toHaveProperty('limitId');

  await expect(page.getByTestId('allocations-status')).toContainText(
    'no policy-limit erosion was posted'
  );
  const row = allocationRow(page, 2025);
  await expect(row.getByTestId('allocation-limit-none')).toHaveText('No limit');
  await expect(row.getByTestId('allocation-erosion-none')).toHaveText('No erosion');
  await expect(row.getByTestId('allocation-erosion-badge')).toHaveCount(0);
  await expect(row.getByTestId('allocation-erosion-retry')).toHaveCount(0);
});

test('keeps allocation entry usable when policy limits fail to load and retries the limits read', async ({
  page
}) => {
  const state = await installMocks(page, {
    allocations: [],
    coverages: COVERAGE_VIEWS,
    coverageStatus: 503,
    coverageDetail: 'Policy coverages are temporarily unavailable.'
  });
  await openAllocations(page);

  const limitsError = page.getByTestId('allocation-limits-error');
  await expect(limitsError).toBeVisible();
  await expect(limitsError).toContainText('Policy coverages are temporarily unavailable.');
  await expect(page.getByTestId('allocation-limit-hint')).toContainText(
    'no policy-limit erosion is posted'
  );

  // The optional limit must not block the allocation form.
  await fillAllocation(page, { year: '2025', percent: '10', amount: '50000' });
  await page.getByRole('button', { name: 'Record allocation' }).click();
  await expect(page.getByTestId('allocations-status')).toContainText('Allocated 10.00%');
  expect(state.createBodies[0]).not.toHaveProperty('limitId');

  state.coverageStatus = 200;
  await page.getByRole('button', { name: 'Retry limits' }).click();
  await expect(page.getByTestId('allocation-limits-error')).toHaveCount(0);
  await expect(policyLimitSelect(page).locator('option')).toHaveCount(3);
  await expect(policyLimitSelect(page).locator('option').nth(1)).toContainText(
    'GL · General Liability'
  );
});

test('shows the failed erosion status returned by create with a retry action', async ({ page }) => {
  const state = await installMocks(page, {
    allocations: [],
    coverages: COVERAGE_VIEWS,
    postErosionStatus: 'FAILED',
    postErosionMessage: 'Policy rejected the erosion fact.'
  });
  await openAllocations(page);

  await policyLimitSelect(page).selectOption(LIMIT_GL);
  await fillAllocation(page, { year: '2025', percent: '10', amount: '50000' });
  await page.getByRole('button', { name: 'Record allocation' }).click();

  await expect(page.getByTestId('allocations-status')).toContainText(
    'Policy-limit erosion failed: Policy rejected the erosion fact.'
  );
  await expect(page.getByTestId('allocations-status')).toContainText(
    'The allocation is saved and can be retried.'
  );

  const row = allocationRow(page, 2025);
  await expect(row.getByTestId('allocation-erosion-badge')).toHaveText('Failed');
  await expect(row.getByTestId('allocation-erosion-message')).toContainText(
    'Policy rejected the erosion fact.'
  );
  await expect(row.getByRole('button', { name: 'Retry erosion' })).toBeVisible();
  expect(state.createBodies[0].limitId).toBe(LIMIT_GL);
});

test('keeps a failed allocation retryable and shows the retry error when erosion retry fails', async ({
  page
}) => {
  const state = await installMocks(page, {
    allocations: [FAILED_EROSION],
    coverages: COVERAGE_VIEWS,
    retryStatus: 503,
    retryDetail: 'Policy erosion is temporarily unavailable.'
  });
  await openAllocations(page);

  const row = allocationRow(page, 2024);
  await row.getByRole('button', { name: 'Retry erosion' }).click();

  const retryError = row.getByTestId('allocation-erosion-error');
  await expect(retryError).toBeVisible();
  await expect(retryError).toContainText('Policy erosion is temporarily unavailable.');
  await expect(row.getByTestId('allocation-erosion-badge')).toHaveText('Failed');
  await expect(row.getByTestId('allocation-erosion-message')).toContainText(
    'Policy erosion service unavailable.'
  );
  await expect(row.getByRole('button', { name: 'Retry erosion' })).toBeEnabled();
  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('20.00%');
  expect(state.retryBodies).toHaveLength(1);
});

test('rejects an allocation when the claimed percentages would exceed 100%', async ({ page }) => {
  const state = await installMocks(page, { allocations: [SIXTY_PERCENT] });
  await openAllocations(page);

  await expect(page.getByTestId('allocation-remaining-percent')).toContainText('40.00% remaining');

  await page.getByRole('textbox', { name: 'Layer', exact: true }).fill('EXCESS_1');
  await page.getByRole('spinbutton', { name: 'Allocation percent', exact: true }).fill('50');
  await page.getByRole('spinbutton', { name: 'Allocated amount', exact: true }).fill('100000');
  await page.getByRole('button', { name: 'Record allocation' }).click();

  const formError = page.getByTestId('allocations-form-error');
  await expect(formError).toBeVisible();
  await expect(formError).toContainText('exceeds 100%');
  await expect(formError).toContainText('40.00% remains');
  expect(state.createBodies).toHaveLength(0);
});

test('shows loading then the empty allocation state with zeroed summary values', async ({ page }) => {
  const gate = deferred();
  await installMocks(page, { allocations: [], listGate: gate.promise, coverages: COVERAGE_VIEWS });
  await openAllocations(page);

  await expect(page.getByTestId('allocations-loading')).toBeVisible();
  await expect(page.getByTestId('summary-allocated-amount')).toHaveText('…');

  gate.resolve();

  await expect(page.getByTestId('allocations-empty')).toBeVisible();
  await expect(page.getByTestId('allocations-empty')).toContainText(
    'No policy-year allocations recorded for this claim.'
  );
  await expect(page.getByTestId('summary-allocated-amount')).toHaveText('USD 0.00');
  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('0.00%');
  await expect(page.getByTestId('summary-unallocated')).toHaveText('USD 500,000.00');
  await expect(page.getByTestId('summary-allocation-count')).toHaveText('0');
});

test('contains a load failure, keeps the claim visible, and retries the allocation ledger', async ({
  page
}) => {
  const state = await installMocks(page, { listStatus: 503, coverages: COVERAGE_VIEWS });
  await openAllocations(page);

  await expect(page.getByTestId('allocations-error')).toBeVisible();
  await expect(page.getByTestId('allocations-error')).toContainText(
    'The allocation ledger is temporarily unavailable.'
  );
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();

  state.listStatus = 200;
  state.allocations = [EXCESS_2024];
  await page.getByRole('button', { name: 'Retry allocations' }).click();

  await expect(page.getByTestId('allocations-error')).toBeHidden();
  await expect(allocationRow(page, 2024)).toContainText('EXCESS_1');
  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('25.00%');
});

test('keeps the form on a 409 conflict and reloads the latest allocation totals', async ({ page }) => {
  const state = await installMocks(page, { allocations: [THIRTY_PERCENT] });
  state.postStatus = 409;
  state.postDetail = 'Allocations for claim CLM-2026-0000301 would total 1.10, which exceeds 1';
  state.onPost = () => {
    state.allocations = [SEVENTY_PERCENT];
  };
  await openAllocations(page);

  await page.getByRole('textbox', { name: 'Layer', exact: true }).fill('EXCESS_1');
  await page.getByRole('spinbutton', { name: 'Allocation percent', exact: true }).fill('50');
  await page.getByRole('spinbutton', { name: 'Allocated amount', exact: true }).fill('50000');
  await page.getByRole('button', { name: 'Record allocation' }).click();

  const stale = page.getByTestId('allocations-stale');
  await expect(stale).toBeVisible();
  await expect(stale).toContainText('exceeds 1');
  await expect(stale).toContainText('reload the allocations');
  await expect(page.getByRole('spinbutton', { name: 'Allocation percent', exact: true })).toHaveValue('50');
  expect(state.createBodies).toHaveLength(1);

  await page.getByRole('button', { name: 'Reload allocations' }).click();

  await expect(page.getByTestId('allocations-stale')).toBeHidden();
  await expect(page.getByTestId('summary-allocated-pct')).toHaveText('70.00%');
  await expect(page.getByTestId('allocation-remaining-percent')).toContainText('30.00% remaining');
});
