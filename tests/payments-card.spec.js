import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d61';
const CLAIM_ID_2 = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d62';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000301',
  claimType: 'BODILY_INJURY',
  status: 'IN_SETTLEMENT',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '125000.0000',
  currentReserveAmount: '125000.0000',
  reserveCurrency: 'USD',
  version: 1
};

const CLAIM_2 = {
  ...CLAIM,
  id: CLAIM_ID_2,
  claimNumber: 'CLM-2026-0000302'
};

const PAYMENT_SUBMITTED = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d71',
  tenantId: TENANT,
  paymentNumber: 'PAY-2026-0000001',
  amount: '300000.00',
  currency: 'USD',
  status: 'SUBMITTED',
  payeeName: 'Meridian Manufacturing',
  payeePartyId: PARTY_ID,
  sourceType: 'DIRECT_CLAIM',
  sourceId: CLAIM_ID,
  sourceReference: CLAIM.claimNumber,
  createdAt: '2026-04-02T10:15:00Z'
};

const PAYMENT_PAID = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d72',
  tenantId: TENANT,
  paymentNumber: 'PAY-2026-0000002',
  amount: '25000.50',
  currency: 'USD',
  status: 'PAID',
  // No payeeName: the card falls back to the party id the DTO carries.
  payeePartyId: PARTY_ID,
  sourceType: 'DIRECT_CLAIM',
  sourceId: CLAIM_ID,
  sourceReference: CLAIM.claimNumber,
  createdAt: '2026-03-28T14:05:00Z'
};

const PAYMENT_CLAIM_2 = {
  ...PAYMENT_PAID,
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d73',
  paymentNumber: 'PAY-2026-0000003',
  sourceId: CLAIM_ID_2,
  sourceReference: CLAIM_2.claimNumber
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the claim queue, the Overview's other detail reads, and the Payment
 * lookup. `gate` holds the payments response open to prove the claim renders
 * without it; `status` makes the lookup fail; `paymentsByClaim` scopes the
 * response so a claim switch can be asserted.
 */
async function installMock(page, options = {}) {
  const state = { paymentRequests: [] };
  const claims = options.claims || [CLAIM];

  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, claims);
      return;
    }
    await fulfillJson(route, {});
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/directory', async (route) => {
    await fulfillJson(route, { people: [], teams: [] });
  });

  await page.route('**/api/v1/documents**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/payments**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const sourceId = url.searchParams.get('sourceId');
    state.paymentRequests.push({
      method: request.method(),
      path: url.pathname,
      sourceType: url.searchParams.get('sourceType'),
      sourceId,
      tenant: headers['x-eia-tenant'] || null,
      book: headers['x-eia-book'] || null
    });

    if (options.gate) await options.gate;

    if (options.status && options.status !== 200) {
      await route.fulfill({
        status: options.status,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'EIA-PAY-5030',
          category: 'UNAVAILABLE',
          message: 'Payment service is unavailable'
        })
      });
      return;
    }

    if (options.paymentsByClaim) {
      await fulfillJson(route, options.paymentsByClaim[sourceId] || []);
      return;
    }

    await fulfillJson(
      route,
      options.body === undefined ? [PAYMENT_SUBMITTED, PAYMENT_PAID] : options.body
    );
  });

  return state;
}

test('loads claim payments with the DIRECT_CLAIM source query and renders rows', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('payments-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Payments/ })).toBeVisible();
  await expect(page.getByTestId('payments-count')).toHaveText('2');
  await expect(page.getByTestId('payments-context')).toContainText(
    'Payment owns approval and execution'
  );
  await expect(page.getByTestId('payments-context')).toContainText('settlement record');
  await expect(page.getByTestId('payments-context')).toContainText('paid-loss');

  const rows = page.getByTestId('payment-row');
  await expect(rows).toHaveCount(2);

  const submitted = rows.filter({ hasText: PAYMENT_SUBMITTED.paymentNumber });
  await expect(submitted.getByTestId('payment-number')).toHaveText(PAYMENT_SUBMITTED.paymentNumber);
  await expect(submitted.getByTestId('payment-status')).toContainText('SUBMITTED');
  await expect(submitted.getByTestId('payment-amount')).toHaveText('USD 300,000.00');
  await expect(submitted.getByTestId('payment-payee')).toHaveText(PAYMENT_SUBMITTED.payeeName);
  await expect(submitted.getByTestId('payment-created')).toHaveText('2026-04-02');
  await expect(submitted.getByRole('link')).toHaveAttribute(
    'href',
    `/payment?record=${PAYMENT_SUBMITTED.id}`
  );

  const paid = rows.filter({ hasText: PAYMENT_PAID.paymentNumber });
  await expect(paid.getByTestId('payment-status')).toContainText('PAID');
  await expect(paid.getByTestId('payment-amount')).toHaveText('USD 25,000.50');
  await expect(paid.getByTestId('payment-payee')).toHaveText(PARTY_ID);
  await expect(paid.getByTestId('payment-created')).toHaveText('2026-03-28');
  await expect(paid.getByRole('link')).toHaveAttribute('href', `/payment?record=${PAYMENT_PAID.id}`);

  await expect(page.getByTestId('payments-summary')).toContainText('Total paid');
  await expect(page.getByTestId('payments-paid-total')).toHaveText('USD 25,000.50');
  await expect(page.getByTestId('payments-pending-count')).toHaveText('1');

  expect(state.paymentRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/payments',
      sourceType: 'DIRECT_CLAIM',
      sourceId: CLAIM_ID,
      tenant: TENANT,
      book: 'DIRECT'
    }
  ]);
});

test('accepts the {items} page envelope from the payments API', async ({ page }) => {
  await installMock(page, { body: { items: [PAYMENT_SUBMITTED], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('payments-count')).toHaveText('1');
  await expect(page.getByTestId('payment-row')).toHaveCount(1);
  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_SUBMITTED.paymentNumber);
  await expect(page.getByTestId('payments-paid-total')).toHaveText('USD 0.00');
  await expect(page.getByTestId('payments-pending-count')).toHaveText('1');
});

test('shows the empty state with settlement hand-off context', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('payments-count')).toHaveText('0');
  const empty = page.getByTestId('payments-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No payments recorded for this claim yet.');
  await expect(empty).toContainText('handed off to Payment from the Settlements tab');
  await expect(empty).toContainText('Payment owns approval and execution');
  await expect(page.getByTestId('payment-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
});

test('keeps the claim rendered when the payments lookup fails', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('payments-error')).toContainText(
    'Linked payments could not be loaded'
  );
  await expect(page.getByTestId('payments-error')).toContainText('claim record is unaffected');
  await expect(page.getByTestId('payments-count')).toHaveText('—');
  await expect(page.getByTestId('payment-row')).toHaveCount(0);

  // The claim record and its other sections are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toContainText('125,000.00');
  await expect(page.getByTestId('documents-card')).toBeVisible();
});

test('renders the claim before the payments response arrives', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await installMock(page, { gate });

  await page.goto('/');

  await expect(page.getByTestId('payments-loading')).toBeVisible();
  await expect(page.getByTestId('payments-count')).toHaveText('—');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toContainText('125,000.00');

  release();
  await expect(page.getByTestId('payment-row')).toHaveCount(2);
  await expect(page.getByTestId('payments-loading')).toHaveCount(0);
});

test('refetches payments for the newly selected claim', async ({ page }) => {
  const state = await installMock(page, {
    claims: [CLAIM, CLAIM_2],
    paymentsByClaim: {
      [CLAIM_ID]: [PAYMENT_SUBMITTED],
      [CLAIM_ID_2]: [PAYMENT_CLAIM_2]
    }
  });

  await page.goto('/');

  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_SUBMITTED.paymentNumber);

  await page.getByRole('button', { name: new RegExp(CLAIM_2.claimNumber) }).click();

  await expect(page.getByRole('heading', { name: CLAIM_2.claimNumber })).toBeVisible();
  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_CLAIM_2.paymentNumber);
  await expect(page.getByTestId('payments-count')).toHaveText('1');
  expect(state.paymentRequests.map((entry) => entry.sourceId)).toEqual([CLAIM_ID, CLAIM_ID_2]);
});
