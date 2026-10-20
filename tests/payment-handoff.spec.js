import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d41';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000201',
  policyId: POLICY_ID,
  claimantPartyId: PARTY_ID,
  claimType: 'BODILY_INJURY',
  status: 'IN_SETTLEMENT',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '500000.00',
  currentReserveAmount: '500000.00',
  reserveCurrency: 'USD',
  version: 2,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

const AUTHORIZED_SETTLEMENT = {
  id: 'settlement-authorized',
  tenantId: TENANT,
  claimId: CLAIM_ID,
  settlementNumber: 'SET-2026-0001',
  amount: '300000.00',
  currency: 'USD',
  structure: 'LUMP_SUM',
  releaseScope: 'FULL',
  approvalAuthority: 'Claims Committee',
  paymentInstructions: 'Wire funds per release',
  status: 'AUTHORIZED',
  version: 1
};

const PROPOSED_SETTLEMENT = {
  ...AUTHORIZED_SETTLEMENT,
  id: 'settlement-proposed',
  settlementNumber: 'SET-2026-0002',
  amount: '125000.00',
  status: 'PROPOSED',
  approvalAuthority: null,
  version: 0
};

const DENIED_SETTLEMENT = {
  ...AUTHORIZED_SETTLEMENT,
  id: 'settlement-denied',
  settlementNumber: 'SET-2026-0003',
  amount: '50000.00',
  status: 'DENIED',
  approvalAuthority: null,
  version: 0
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the claim record, its detail sections, the policy/party label lookups,
 * and the Payment search used by the related-payments card. Settlement approve
 * and execute posts mutate `state.settlements` so the workbench can refetch.
 */
async function installMocks(page, options = {}) {
  const state = {
    settlements: (options.settlements || []).map((row) => ({ ...row })),
    paymentItems: options.paymentItems || [],
    paymentRequests: [],
    settlementPosts: []
  };

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
    const rest = url.pathname.slice('/api/v1/claims/'.length);
    const [claimId, section, recordId, verb] = rest.split('/');

    if (request.method() === 'GET') {
      if (!section) {
        await fulfillJson(route, CLAIM);
        return;
      }
      if (section === 'settlements') {
        await fulfillJson(route, state.settlements);
        return;
      }
      if (section === 'coverage') {
        await fulfillJson(route, { message: 'No coverage decision recorded' }, 404);
        return;
      }
      if (section === 'reserves') {
        await fulfillJson(route, {
          claimId,
          currency: 'USD',
          totalCurrentAmount: '0.0000',
          components: [],
          history: []
        });
        return;
      }
      await fulfillJson(route, []);
      return;
    }

    state.settlementPosts.push({
      path: url.pathname,
      method: request.method(),
      book: request.headers()['x-eia-book'],
      body: request.postDataJSON()
    });

    if (section === 'settlements' && (verb === 'approve' || verb === 'execute')) {
      const nextStatus = verb === 'approve' ? 'AUTHORIZED' : 'EXECUTED';
      state.settlements = state.settlements.map((row) =>
        row.id === recordId ? { ...row, status: nextStatus, version: row.version + 1 } : row
      );
      await fulfillJson(route, state.settlements.find((row) => row.id === recordId));
      return;
    }
    await fulfillJson(route, {});
  });

  await page.route(/\/api\/v1\/policies\/[^/]+$/, async (route) => {
    await fulfillJson(route, { id: POLICY_ID, policyNumber: 'POL-2026-0001', productCode: 'GL' });
  });

  await page.route(/\/api\/v1\/parties\/[^/]+$/, async (route) => {
    await fulfillJson(route, {
      id: PARTY_ID,
      displayName: 'Meridian Manufacturing',
      partyNumber: 'PTY-2026-0001'
    });
  });

  await page.route('**/api/v1/payments**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.paymentRequests.push({
      method: request.method(),
      path: url.pathname,
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      tenant: request.headers()['x-eia-tenant']
    });
    if (request.method() === 'GET' && url.pathname === '/api/v1/payments/search') {
      await fulfillJson(route, {
        query: url.searchParams.get('q') || '',
        limit: 5,
        items: state.paymentItems
      });
      return;
    }
    await fulfillJson(route, {}, 201);
  });

  return state;
}

async function openSettlements(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Settlements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settlements', exact: true })).toBeVisible();
}

function handOffParams(href) {
  const url = new URL(href, 'http://localhost:3004');
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams) };
}

test('the Overview context panel states the settlement-to-Payment boundary', async ({ page }) => {
  await installMocks(page, { settlements: [AUTHORIZED_SETTLEMENT] });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();

  await expect(page.getByText(/handed to Payment from the Settlements tab/i)).toBeVisible();
  await expect(page.getByText(/Payment owns payment approval and execution/i)).toBeVisible();
});

test('an authorized settlement offers Create payment with the full hand-off URL', async ({ page }) => {
  const state = await installMocks(page, { settlements: [AUTHORIZED_SETTLEMENT] });
  await openSettlements(page);

  const action = page.getByTestId(`create-payment-${AUTHORIZED_SETTLEMENT.id}`);
  await expect(action).toBeVisible();
  await expect(action).toHaveText('Create payment');

  const expectedHref =
    `/payment?new=1&sourceType=DIRECT_CLAIM&sourceId=${CLAIM_ID}` +
    `&sourceReference=${CLAIM.claimNumber}&amount=300000.00&currency=USD&payeePartyId=${PARTY_ID}`;
  await expect(action).toHaveAttribute('href', expectedHref);

  expect(handOffParams(expectedHref)).toEqual({
    pathname: '/payment',
    params: {
      new: '1',
      sourceType: 'DIRECT_CLAIM',
      sourceId: CLAIM_ID,
      sourceReference: CLAIM.claimNumber,
      amount: '300000.00',
      currency: 'USD',
      payeePartyId: PARTY_ID
    }
  });

  // Direct Claims only navigates: it never posts the payment itself.
  expect(state.paymentRequests.every((entry) => entry.method === 'GET')).toBeTruthy();

  await action.click();
  await expect(page).toHaveURL(expectedHref);
});

test('draft/proposed and denied settlements do not offer Create payment', async ({ page }) => {
  const state = await installMocks(page, {
    settlements: [PROPOSED_SETTLEMENT, DENIED_SETTLEMENT]
  });
  await openSettlements(page);

  await expect(
    page.getByRole('cell', { name: PROPOSED_SETTLEMENT.settlementNumber, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: DENIED_SETTLEMENT.settlementNumber, exact: true })
  ).toBeVisible();
  await expect(page.getByTestId(/^create-payment-/)).toHaveCount(0);
  await expect(page.getByText('Create payment', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Approve ${PROPOSED_SETTLEMENT.settlementNumber}` })).toBeEnabled();
  expect(state.paymentRequests.every((entry) => entry.method === 'GET')).toBeTruthy();
});

test('executed and paid settlements keep the payment hand-off available', async ({ page }) => {
  await installMocks(page, {
    settlements: [
      { ...AUTHORIZED_SETTLEMENT, id: 'settlement-executed', settlementNumber: 'SET-2026-0004', status: 'EXECUTED' },
      {
        ...AUTHORIZED_SETTLEMENT,
        id: 'settlement-paid',
        settlementNumber: 'SET-2026-0005',
        status: 'PAID',
        amount: '175000.00'
      }
    ]
  });
  await openSettlements(page);

  await expect(page.getByTestId('create-payment-settlement-executed')).toBeVisible();
  await expect(page.getByTestId('create-payment-settlement-paid')).toBeVisible();
  await expect(page.getByTestId('create-payment-settlement-paid')).toHaveAttribute(
    'href',
    new RegExp(`amount=175000\\.00.*payeePartyId=${PARTY_ID}$`)
  );
});

test('related payments request the claim query and link each payment record', async ({ page }) => {
  const submittedPayment = {
    id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d51',
    type: 'PAYMENT',
    label: 'PAY-2026-0000001',
    secondary: 'INDEMNITY · SUBMITTED',
    status: 'SUBMITTED',
    amount: '300000.00',
    currency: 'USD',
    href: '/payment?record=0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d51'
  };
  const paidPayment = {
    id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d52',
    type: 'PAYMENT',
    label: 'PAY-2026-0000002',
    secondary: 'EXPENSE · PAID',
    status: 'PAID',
    amount: '25000.50',
    currency: 'EUR'
  };

  const state = await installMocks(page, {
    settlements: [AUTHORIZED_SETTLEMENT],
    paymentItems: [submittedPayment, paidPayment]
  });
  await openSettlements(page);

  const card = page.getByTestId('related-payments');
  await expect(card).toBeVisible();

  const firstLink = page.getByTestId(`related-payment-${submittedPayment.id}`);
  const secondLink = page.getByTestId(`related-payment-${paidPayment.id}`);
  await expect(firstLink).toHaveText('PAY-2026-0000001');
  await expect(firstLink).toHaveAttribute('href', `/payment?record=${submittedPayment.id}`);
  await expect(secondLink).toHaveText('PAY-2026-0000002');
  await expect(secondLink).toHaveAttribute('href', `/payment?record=${paidPayment.id}`);
  await expect(card.getByText('SUBMITTED', { exact: true })).toBeVisible();
  await expect(card.getByText('PAID', { exact: true })).toBeVisible();
  await expect(card.getByText('USD 300,000.00')).toBeVisible();
  await expect(card.getByText('EUR 25,000.50')).toBeVisible();

  expect(state.paymentRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/payments/search',
      q: CLAIM_ID,
      limit: '5',
      tenant: TENANT
    }
  ]);
});

test('related payments show an empty state when the claim has none', async ({ page }) => {
  await installMocks(page, { settlements: [AUTHORIZED_SETTLEMENT], paymentItems: [] });
  await openSettlements(page);

  await expect(page.getByTestId('related-payments')).toContainText('No payments recorded for this claim.');
});

test('authorizing a proposed settlement reveals the hand-off and keeps the settlement flow', async ({ page }) => {
  const state = await installMocks(page, { settlements: [PROPOSED_SETTLEMENT] });
  await openSettlements(page);

  await expect(page.getByTestId(`create-payment-${PROPOSED_SETTLEMENT.id}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Execute ${PROPOSED_SETTLEMENT.settlementNumber}` })).toBeDisabled();

  await page.getByRole('button', { name: `Approve ${PROPOSED_SETTLEMENT.settlementNumber}` }).click();

  const action = page.getByTestId(`create-payment-${PROPOSED_SETTLEMENT.id}`);
  await expect(action).toBeVisible();
  await expect(page.getByRole('button', { name: `Execute ${PROPOSED_SETTLEMENT.settlementNumber}` })).toBeEnabled();

  const { params } = handOffParams(await action.getAttribute('href'));
  expect(params.amount).toBe(PROPOSED_SETTLEMENT.amount);
  expect(params.sourceType).toBe('DIRECT_CLAIM');
  expect(params.sourceId).toBe(CLAIM_ID);
  expect(params.sourceReference).toBe(CLAIM.claimNumber);
  expect(params.currency).toBe('USD');
  expect(params.payeePartyId).toBe(PARTY_ID);

  expect(state.settlementPosts).toHaveLength(1);
  expect(state.settlementPosts[0].method).toBe('POST');
  expect(state.settlementPosts[0].body.approvalAuthority).toBe('Claims Committee');
  expect(state.settlementPosts[0].body.expectedVersion).toBe(0);
  expect(state.paymentRequests.every((entry) => entry.method === 'GET')).toBeTruthy();
});
