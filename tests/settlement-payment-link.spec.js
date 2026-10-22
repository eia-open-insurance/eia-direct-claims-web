import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d41';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const PAYMENT_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d51';
const PAYMENT_NUMBER = 'PAY-2026-0000042';
const PAYMENT_ID_2 = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d52';
const PAYMENT_NUMBER_2 = 'PAY-2026-0000043';

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

function settlement(overrides = {}) {
  return {
    id: 'settlement-1',
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
    version: 2,
    ...overrides
  };
}

function payment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT,
    paymentNumber: PAYMENT_NUMBER,
    paymentType: 'INDEMNITY',
    status: 'PAID',
    amount: '300000.00',
    currency: 'USD',
    payeePartyId: PARTY_ID,
    paymentDate: '2026-04-01',
    sourceType: 'DIRECT_CLAIM',
    sourceId: CLAIM_ID,
    sourceReference: CLAIM.claimNumber,
    version: 3,
    ...overrides
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the claim record, its detail sections, the policy/party label reads,
 * the claim-scoped payment list used by the link dialog, and the settlement
 * payment PATCH. The PATCH mutates `state.settlements` so the workbench can
 * assert the row and the claim refresh that follow a successful link.
 */
async function installMocks(page, options = {}) {
  const state = {
    settlements: (options.settlements || []).map((row) => ({ ...row })),
    payments: (options.payments || []).map((row) => ({ ...row })),
    paymentListStatus: options.paymentListStatus || 200,
    paymentListMessage: options.paymentListMessage || 'Related claim payments are temporarily unavailable.',
    paymentDetailStatus: options.paymentDetailStatus || 200,
    paymentDetailMessage: options.paymentDetailMessage || 'Payment detail is temporarily unavailable.',
    paymentPatchStatus: options.paymentPatchStatus || 200,
    paymentPatchMessage: options.paymentPatchMessage || 'The payment link could not be saved.',
    claimListGets: 0,
    settlementGets: 0,
    paymentListRequests: [],
    paymentGets: [],
    paymentLinkPatches: []
  };

  // Keep the rest of the workbench quiet. Specific routes registered later win.
  await page.route('**/api/v1/**', async (route) => fulfillJson(route, []));

  await page.route('**/api/v1/claims', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      state.claimListGets += 1;
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
        state.settlementGets += 1;
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

    if (
      request.method() === 'PATCH' &&
      section === 'settlements' &&
      recordId &&
      verb === 'payment'
    ) {
      const body = request.postDataJSON();
      state.paymentLinkPatches.push({
        path: url.pathname,
        method: request.method(),
        body,
        headers: request.headers()
      });
      if (state.paymentPatchStatus !== 200) {
        await fulfillJson(route, { message: state.paymentPatchMessage }, state.paymentPatchStatus);
        return;
      }
      const linkedPayment = state.payments.find((row) => row.id === body.paymentId);
      state.settlements = state.settlements.map((row) =>
        row.id === recordId
          ? {
              ...row,
              paymentId: body.paymentId,
              paymentNumber: body.paymentId ? linkedPayment?.paymentNumber || null : null,
              version: (row.version || 0) + 1
            }
          : row
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
    if (request.method() === 'GET' && url.pathname === '/api/v1/payments') {
      state.paymentListRequests.push({
        query: Object.fromEntries(url.searchParams),
        headers: request.headers()
      });
      if (state.paymentListStatus !== 200) {
        await fulfillJson(route, { message: state.paymentListMessage }, state.paymentListStatus);
        return;
      }
      await fulfillJson(route, state.payments);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/v1/payments/search') {
      await fulfillJson(route, { items: [] });
      return;
    }
    if (request.method() === 'GET') {
      const paymentId = url.pathname.slice('/api/v1/payments/'.length);
      state.paymentGets.push(paymentId);
      if (state.paymentDetailStatus !== 200) {
        await fulfillJson(route, { message: state.paymentDetailMessage }, state.paymentDetailStatus);
        return;
      }
      const found = state.payments.find((row) => row.id === paymentId);
      if (found) {
        await fulfillJson(route, found);
        return;
      }
      await fulfillJson(route, { message: 'Payment not found' }, 404);
      return;
    }
    await fulfillJson(route, {});
  });

  return state;
}

async function openSettlements(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Settlements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settlements', exact: true })).toBeVisible();
}

async function openLinkDialog(page, settlementId) {
  await page.getByTestId(`link-payment-${settlementId}`).click();
  const dialog = page.getByTestId('link-payment-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('shows the linked payment number, a dash when unlinked, and linkable actions', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-linked',
    settlementNumber: 'SET-2026-0010',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const hydrated = settlement({
    id: 'settlement-hydrated',
    settlementNumber: 'SET-2026-0011',
    status: 'AUTHORIZED',
    paymentId: PAYMENT_ID_2
  });
  const unlinked = settlement({
    id: 'settlement-unlinked',
    settlementNumber: 'SET-2026-0012',
    status: 'AUTHORIZED'
  });
  const executedUnlinked = settlement({
    id: 'settlement-executed',
    settlementNumber: 'SET-2026-0013',
    status: 'EXECUTED'
  });
  const proposed = settlement({
    id: 'settlement-proposed',
    settlementNumber: 'SET-2026-0014',
    status: 'PROPOSED'
  });

  const state = await installMocks(page, {
    settlements: [linked, hydrated, unlinked, executedUnlinked, proposed],
    payments: [payment({ id: PAYMENT_ID_2, paymentNumber: PAYMENT_NUMBER_2 })]
  });
  await openSettlements(page);

  await expect(
    page.getByRole('region', { name: 'Settlements' }).getByRole('columnheader', { name: 'Payment', exact: true })
  ).toBeVisible();

  const linkedRow = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  const linkedCell = linkedRow.getByTestId(`settlement-payment-${linked.id}`);
  await expect(linkedCell).toHaveText(PAYMENT_NUMBER);
  await expect(linkedCell).toHaveAttribute('href', `/payment?record=${PAYMENT_ID}`);

  // A projection without paymentNumber is hydrated from the Payment read.
  const hydratedCell = page
    .getByRole('row', { name: new RegExp(hydrated.settlementNumber) })
    .getByTestId(`settlement-payment-${hydrated.id}`);
  await expect(hydratedCell).toHaveText(PAYMENT_NUMBER_2);
  expect(state.paymentGets).toContain(PAYMENT_ID_2);

  const unlinkedRow = page.getByRole('row', { name: new RegExp(unlinked.settlementNumber) });
  await expect(unlinkedRow.getByTestId(`settlement-payment-${unlinked.id}`)).toHaveText('—');
  await expect(unlinkedRow.getByTestId(`link-payment-${unlinked.id}`)).toHaveText('Link payment');

  const executedRow = page.getByRole('row', { name: new RegExp(executedUnlinked.settlementNumber) });
  await expect(executedRow.getByTestId(`link-payment-${executedUnlinked.id}`)).toBeVisible();

  // A linked settlement offers Unlink, not a second Link payment.
  await expect(linkedRow.getByTestId(`unlink-payment-${linked.id}`)).toHaveText('Unlink');
  await expect(linkedRow.getByTestId(`link-payment-${linked.id}`)).toHaveCount(0);

  // PROPOSED is not a link target.
  const proposedRow = page.getByRole('row', { name: new RegExp(proposed.settlementNumber) });
  await expect(proposedRow.getByTestId(`link-payment-${proposed.id}`)).toHaveCount(0);
  await expect(proposedRow.getByTestId(`unlink-payment-${proposed.id}`)).toHaveCount(0);
});

test('shows a PAID status badge without a warning and reads it from Payment', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-paid',
    settlementNumber: 'SET-2026-0015',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const state = await installMocks(page, {
    settlements: [linked],
    payments: [payment()]
  });
  await openSettlements(page);

  const row = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText(PAYMENT_NUMBER);

  const badge = row.getByTestId(`settlement-payment-status-${linked.id}`);
  await expect(badge).toHaveText('PAID');
  await expect(badge).toHaveClass(/eia-pill/);
  await expect(badge).toHaveClass(/green/);
  await expect(row.getByTestId(`settlement-payment-warning-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toBeVisible();

  // The settlement projection carries only the number, so the status must
  // come from GET /api/v1/payments/{paymentId}.
  expect(state.paymentGets).toContain(PAYMENT_ID);
});

test('warns and links to Payment when the linked payment is REVERSED', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-reversed',
    settlementNumber: 'SET-2026-0016',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const state = await installMocks(page, {
    settlements: [linked],
    payments: [payment({ status: 'REVERSED' })]
  });
  await openSettlements(page);

  const row = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  const badge = row.getByTestId(`settlement-payment-status-${linked.id}`);
  await expect(badge).toHaveText('REVERSED');
  await expect(badge).toHaveClass(/red/);

  const warning = row.getByTestId(`settlement-payment-warning-${linked.id}`);
  await expect(warning).toHaveText('Payment REVERSED — settlement link needs review');
  await expect(warning).toHaveAttribute('href', `/payment?record=${PAYMENT_ID}`);

  // A review warning never removes the operator's way out of the link.
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toBeVisible();
  expect(state.paymentGets).toContain(PAYMENT_ID);

  const context = page.getByTestId('settlement-link-context');
  await expect(context).toContainText('evidence only');
  await expect(context).toContainText('does not change the payment status');
  await expect(context).toContainText('not changed automatically');
  await expect(context).toContainText('unlink the payment or re-execute the settlement');
});

test('contains a payment status read failure and keeps the projected number', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-status-failure',
    settlementNumber: 'SET-2026-0017',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const state = await installMocks(page, {
    settlements: [linked],
    payments: [payment()],
    paymentDetailStatus: 503,
    paymentDetailMessage: 'Payment detail is temporarily unavailable.'
  });
  await openSettlements(page);

  const row = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText(PAYMENT_NUMBER);
  await expect(row.getByTestId(`settlement-payment-status-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`settlement-payment-warning-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toBeVisible();
  await expect(page.getByTestId('settlement-error')).toHaveCount(0);
  expect(state.paymentGets).toContain(PAYMENT_ID);
});

test('unlinks a REVERSED linked payment and clears the warning', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-reversed-unlink',
    settlementNumber: 'SET-2026-0018',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const state = await installMocks(page, {
    settlements: [linked],
    payments: [payment({ status: 'REVERSED' })]
  });
  await openSettlements(page);

  const row = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-warning-${linked.id}`)).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain(`Unlink ${PAYMENT_NUMBER} from ${linked.settlementNumber}`);
    await dialog.accept();
  });
  await row.getByTestId(`unlink-payment-${linked.id}`).click();

  await expect(page.getByTestId('settlement-status')).toContainText(
    `${linked.settlementNumber} unlinked from ${PAYMENT_NUMBER}`
  );
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText('—');
  await expect(row.getByTestId(`settlement-payment-status-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`settlement-payment-warning-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`link-payment-${linked.id}`)).toBeVisible();

  expect(state.paymentLinkPatches).toHaveLength(1);
  expect(state.paymentLinkPatches[0].path).toBe(
    `/api/v1/claims/${CLAIM_ID}/settlements/${linked.id}/payment`
  );
  expect(state.paymentLinkPatches[0].body).toEqual({ paymentId: null });
  expect(state.settlements.find((entry) => entry.id === linked.id).paymentId).toBeNull();
});

test('links a PAID DIRECT_CLAIM payment with the PATCH payload and updates the row', async ({ page }) => {
  const target = settlement({
    id: 'settlement-target',
    settlementNumber: 'SET-2026-0020',
    status: 'AUTHORIZED'
  });
  const other = settlement({
    id: 'settlement-other',
    settlementNumber: 'SET-2026-0021',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID_2,
    paymentNumber: PAYMENT_NUMBER_2
  });
  const paid = payment();
  const paidElsewhere = payment({
    id: PAYMENT_ID_2,
    paymentNumber: PAYMENT_NUMBER_2,
    amount: '125000.00'
  });
  const draft = payment({
    id: 'payment-draft',
    paymentNumber: 'PAY-2026-0000044',
    status: 'DRAFT'
  });
  const submitted = payment({
    id: 'payment-submitted',
    paymentNumber: 'PAY-2026-0000045',
    status: 'SUBMITTED'
  });

  const state = await installMocks(page, {
    settlements: [target, other],
    payments: [paid, paidElsewhere, draft, submitted]
  });
  await openSettlements(page);

  const listRequestsBefore = state.paymentListRequests.length;
  const claimGetsBefore = state.claimListGets;
  const dialog = await openLinkDialog(page, target.id);

  await expect(
    dialog.getByRole('heading', { name: `Link payment to ${target.settlementNumber}` })
  ).toBeVisible();
  await expect(dialog.getByRole('table', { name: 'Related claim payments' })).toBeVisible();
  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText(PAYMENT_NUMBER);
  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText('PAID');
  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText('USD 300,000.00');
  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText('INDEMNITY');
  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText('2026-04-01');

  // Payments already linked to another settlement are shown but not selectable.
  const otherOption = dialog.getByTestId(`payment-option-${PAYMENT_ID_2}`);
  await expect(otherOption).toContainText(PAYMENT_NUMBER_2);
  await expect(otherOption.getByTestId(`payment-option-linked-${PAYMENT_ID_2}`)).toContainText(
    `Linked to ${other.settlementNumber}`
  );
  await expect(
    dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER_2}` })
  ).toBeDisabled();
  await expect(dialog.getByTestId('link-payment-linked-note')).toBeVisible();

  // Only PAID payments are listed.
  await expect(dialog.getByTestId('payment-option-payment-draft')).toHaveCount(0);
  await expect(dialog.getByTestId('payment-option-payment-submitted')).toHaveCount(0);
  await expect(dialog.getByText('DRAFT', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('SUBMITTED', { exact: true })).toHaveCount(0);

  const listRequests = state.paymentListRequests.slice(listRequestsBefore);
  expect(listRequests.length).toBeGreaterThanOrEqual(1);
  expect(listRequests[0].query).toEqual({
    sourceType: 'DIRECT_CLAIM',
    sourceId: CLAIM_ID
  });
  expect(listRequests[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(listRequests[0].headers['x-eia-book']).toBe('DIRECT');

  await expect(dialog.getByTestId('apply-payment-link')).toBeDisabled();
  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER}` }).check();
  await expect(dialog.getByTestId('apply-payment-link')).toBeEnabled();
  await dialog.getByTestId('apply-payment-link').click();

  await expect(page.getByTestId('link-payment-dialog')).toHaveCount(0);
  const row = page.getByRole('row', { name: new RegExp(target.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-${target.id}`)).toHaveText(PAYMENT_NUMBER);
  await expect(row.getByTestId(`settlement-payment-${target.id}`)).toHaveAttribute(
    'href',
    `/payment?record=${PAYMENT_ID}`
  );
  await expect(row.getByTestId(`unlink-payment-${target.id}`)).toBeVisible();
  await expect(row.getByTestId(`link-payment-${target.id}`)).toHaveCount(0);
  await expect(page.getByTestId('settlement-status')).toContainText(
    `${target.settlementNumber} linked to ${PAYMENT_NUMBER}`
  );
  await expect(page.getByTestId('settlement-status')).toContainText('unchanged');

  expect(state.paymentLinkPatches).toHaveLength(1);
  expect(state.paymentLinkPatches[0].path).toBe(
    `/api/v1/claims/${CLAIM_ID}/settlements/${target.id}/payment`
  );
  expect(state.paymentLinkPatches[0].method).toBe('PATCH');
  expect(state.paymentLinkPatches[0].body).toEqual({ paymentId: PAYMENT_ID });
  expect(state.paymentLinkPatches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.paymentLinkPatches[0].headers['x-eia-book']).toBe('DIRECT');
  expect(state.settlements.find((entry) => entry.id === target.id).paymentId).toBe(PAYMENT_ID);

  // A successful link refreshes the claim record through onChanged.
  await expect.poll(() => state.claimListGets).toBeGreaterThan(claimGetsBefore);
});

test('unlinks a payment only after confirmation and clears the row', async ({ page }) => {
  const linked = settlement({
    id: 'settlement-linked',
    settlementNumber: 'SET-2026-0030',
    status: 'EXECUTED',
    paymentId: PAYMENT_ID,
    paymentNumber: PAYMENT_NUMBER
  });
  const state = await installMocks(page, { settlements: [linked], payments: [payment()] });
  await openSettlements(page);

  const row = page.getByRole('row', { name: new RegExp(linked.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText(PAYMENT_NUMBER);

  let cancelledMessage = '';
  page.once('dialog', async (dialog) => {
    cancelledMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.getByTestId(`unlink-payment-${linked.id}`).click();

  expect(cancelledMessage).toContain(`Unlink ${PAYMENT_NUMBER} from ${linked.settlementNumber}`);
  expect(cancelledMessage).toContain('paid loss');
  expect(state.paymentLinkPatches).toHaveLength(0);
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText(PAYMENT_NUMBER);
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toBeVisible();

  let confirmedMessage = '';
  page.once('dialog', async (dialog) => {
    confirmedMessage = dialog.message();
    await dialog.accept();
  });
  await page.getByTestId(`unlink-payment-${linked.id}`).click();

  expect(confirmedMessage).toContain(`Unlink ${PAYMENT_NUMBER}`);
  await expect(page.getByTestId('settlement-status')).toContainText(
    `${linked.settlementNumber} unlinked from ${PAYMENT_NUMBER}`
  );
  await expect(row.getByTestId(`settlement-payment-${linked.id}`)).toHaveText('—');
  await expect(row.getByTestId(`unlink-payment-${linked.id}`)).toHaveCount(0);
  await expect(row.getByTestId(`link-payment-${linked.id}`)).toBeVisible();

  expect(state.paymentLinkPatches).toHaveLength(1);
  expect(state.paymentLinkPatches[0].path).toBe(
    `/api/v1/claims/${CLAIM_ID}/settlements/${linked.id}/payment`
  );
  expect(state.paymentLinkPatches[0].body).toEqual({ paymentId: null });
  expect(state.settlements.find((entry) => entry.id === linked.id).paymentId).toBeNull();
});

test('explains how to create and approve a payment when no PAID claim payment exists', async ({ page }) => {
  const target = settlement({
    id: 'settlement-target',
    settlementNumber: 'SET-2026-0040',
    status: 'AUTHORIZED'
  });
  const state = await installMocks(page, {
    settlements: [target],
    payments: [
      payment({ id: 'payment-draft', paymentNumber: 'PAY-2026-0000051', status: 'DRAFT' }),
      payment({ id: 'payment-submitted', paymentNumber: 'PAY-2026-0000052', status: 'SUBMITTED' })
    ]
  });
  await openSettlements(page);
  const dialog = await openLinkDialog(page, target.id);

  const empty = dialog.getByTestId('link-payment-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No PAID claim payments are available.');
  await expect(empty).toContainText('Create a payment for this claim in the Payment workbench');
  await expect(empty).toContainText('approve and pay it');
  await expect(empty).toContainText('DIRECT_CLAIM');
  await expect(dialog.getByTestId('link-payment-not-paid')).toContainText(
    '2 related payments are not PAID yet.'
  );

  const create = dialog.getByTestId('link-payment-create');
  await expect(create).toHaveText('Create payment in Payment');
  await expect(create).toHaveAttribute(
    'href',
    new RegExp(
      `^/payment\\?new=1&sourceType=DIRECT_CLAIM&sourceId=${CLAIM_ID}.*amount=300000\\.00`
    )
  );
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByTestId('apply-payment-link')).toHaveCount(0);

  const context = dialog.getByTestId('link-payment-context');
  await expect(context).toContainText('does not change the payment status');
  await expect(context).toContainText('paid loss');
  expect(state.paymentListRequests.length).toBeGreaterThan(0);
});

test('keeps the dialog and row unchanged when the link PATCH fails', async ({ page }) => {
  const target = settlement({
    id: 'settlement-target',
    settlementNumber: 'SET-2026-0050',
    status: 'AUTHORIZED'
  });
  const message = 'Payment is already linked to another settlement.';
  const state = await installMocks(page, {
    settlements: [target],
    payments: [payment()],
    paymentPatchStatus: 409,
    paymentPatchMessage: message
  });
  await openSettlements(page);
  const dialog = await openLinkDialog(page, target.id);

  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER}` }).check();
  await dialog.getByTestId('apply-payment-link').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('apply-payment-link-error')).toContainText(message);
  await expect(page.getByTestId('settlement-status')).toHaveCount(0);

  const row = page.getByRole('row', { name: new RegExp(target.settlementNumber) });
  await expect(row.getByTestId(`settlement-payment-${target.id}`)).toHaveText('—');
  await expect(row.getByTestId(`link-payment-${target.id}`)).toBeVisible();
  await expect(row.getByTestId(`unlink-payment-${target.id}`)).toHaveCount(0);

  expect(state.paymentLinkPatches).toHaveLength(1);
  expect(state.paymentLinkPatches[0].body).toEqual({ paymentId: PAYMENT_ID });
  expect(state.settlements.find((entry) => entry.id === target.id).paymentId).toBeUndefined();
});

test('contains a payment list failure and retries without closing the dialog', async ({ page }) => {
  const target = settlement({
    id: 'settlement-target',
    settlementNumber: 'SET-2026-0060',
    status: 'AUTHORIZED'
  });
  const state = await installMocks(page, {
    settlements: [target],
    payments: [payment()],
    paymentListStatus: 503,
    paymentListMessage: 'Related claim payments are temporarily unavailable.'
  });
  await openSettlements(page);
  const dialog = await openLinkDialog(page, target.id);

  await expect(dialog.getByTestId('link-payment-error')).toContainText(
    'Related claim payments are temporarily unavailable.'
  );
  await expect(dialog.getByTestId('link-payment-loading')).toHaveCount(0);
  await expect(dialog.getByTestId('apply-payment-link')).toHaveCount(0);

  state.paymentListStatus = 200;
  await dialog.getByRole('button', { name: 'Retry' }).click();

  await expect(dialog.getByTestId(`payment-option-${PAYMENT_ID}`)).toContainText(PAYMENT_NUMBER);
  await expect(dialog.getByTestId('link-payment-error')).toHaveCount(0);
});
