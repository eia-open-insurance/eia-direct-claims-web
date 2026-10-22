import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const CLAIMANT_PARTY_ID = '33333333-3333-7333-8333-333333333333';
const COUNSEL_PARTY_ID = '99999999-9999-7999-8999-999999999999';
const MATTER_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000401',
  policyId: POLICY_ID,
  claimantPartyId: CLAIMANT_PARTY_ID,
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

const COUNSEL_ITEM = {
  id: COUNSEL_PARTY_ID,
  type: 'PARTY',
  label: 'PTY-2026-0042',
  secondary: 'Ridgeline & Associates · LAW_FIRM',
  status: 'ACTIVE',
  href: `/party?record=${COUNSEL_PARTY_ID}`
};

function makeMatter(overrides = {}) {
  return {
    id: MATTER_ID,
    tenantId: TENANT,
    claimId: CLAIM_ID,
    matterType: 'DEFENSE',
    jurisdiction: 'US-OH',
    counselPartyId: COUNSEL_PARTY_ID,
    filingDate: '2026-04-01',
    trialDate: null,
    status: 'ACTIVE',
    caseNumber: 'CASE-2026-0042',
    version: 0,
    createdAt: '2026-04-02T09:00:00Z',
    updatedAt: '2026-04-02T09:00:00Z',
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
    matters: options.matters ? [...options.matters] : [],
    createBodies: [],
    createHeaders: [],
    searchRequests: [],
    partyDetailHeaders: [],
    claimRequests: []
  };

  // Containment for screens the test does not exercise (documents, payments,
  // cessions, events). Later, more specific routes take precedence.
  await page.route('**/api/v1/**', async (route) => {
    await json(route, []);
  });

  await page.route('**/api/v1/directory', async (route) => {
    await json(route, { people: [], teams: [] });
  });

  await page.route(/\/api\/v1\/policies\/[^/]+$/, async (route) => {
    await json(route, {
      id: POLICY_ID,
      policyNumber: 'POL-2026-0001',
      productCode: 'GL'
    });
  });

  await page.route(/\/api\/v1\/parties\/(?!search$)[^/]+$/, async (route) => {
    state.partyDetailHeaders.push(route.request().headers());
    const url = new URL(route.request().url());
    const partyId = url.pathname.split('/').pop();
    await json(route, {
      id: partyId,
      displayName: partyId === COUNSEL_PARTY_ID ? 'Ridgeline & Associates' : 'Meridian Manufacturing',
      partyNumber: partyId === COUNSEL_PARTY_ID ? 'PTY-2026-0042' : 'PTY-2026-0001'
    });
  });

  await page.route('**/api/v1/parties/search**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.searchRequests.push({
      query: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      tenant: request.headers()['x-eia-tenant'],
      book: request.headers()['x-eia-book']
    });
    await json(route, { query: url.searchParams.get('q'), limit: 8, items: [COUNSEL_ITEM] });
  });

  await page.route('**/api/v1/claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.claimRequests.push({
      method: request.method(),
      path,
      book: request.headers()['x-eia-book'],
      tenant: request.headers()['x-eia-tenant']
    });

    if (request.method() === 'GET' && path === '/api/v1/claims') {
      await json(route, [CLAIM]);
      return;
    }

    if (path === `/api/v1/claims/${CLAIM_ID}/litigation`) {
      if (request.method() === 'GET') {
        await json(route, state.matters);
        return;
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        state.createBodies.push(body);
        state.createHeaders.push(request.headers());
        const created = makeMatter({
          ...body,
          version: 0
        });
        state.matters = [created, ...state.matters];
        await json(route, created, 201);
        return;
      }
    }

    if (request.method() === 'GET') {
      if (path.endsWith('/coverage')) {
        await json(route, { message: 'No coverage decision recorded' }, 404);
        return;
      }
      if (path.endsWith('/reserves')) {
        await json(route, {
          totalCurrentAmount: '0.0000',
          currency: 'USD',
          components: [],
          history: []
        });
        return;
      }
      await json(route, []);
      return;
    }

    await json(route, {}, 404);
  });

  return state;
}

async function openLitigation(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(CLAIM.claimNumber) }).click();
  await page.getByRole('tab', { name: 'Litigation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open a litigation matter' })).toBeVisible();
}

async function selectCounsel(page) {
  await page.getByPlaceholder('Search counsel party number or name…').fill('Ridgeline');
  await page.getByRole('button', { name: /PTY-2026-0042/ }).click();
  await expect(page.getByTestId('litigation-counsel-link')).toHaveText('PTY-2026-0042');
}

async function fillRequiredMatterFields(page) {
  await page.getByLabel('Litigation jurisdiction').fill('US-OH');
  await page.getByLabel('Case number').fill('CASE-2026-0042');
}

test('selects counsel predictively and records the party id plus a damages pair', async ({ page }) => {
  const state = await installMocks(page);
  await openLitigation(page);

  await page.getByPlaceholder('Search counsel party number or name…').fill('Ridgeline');
  await expect(page.getByRole('button', { name: /PTY-2026-0042/ })).toBeVisible();
  await page.getByRole('button', { name: /PTY-2026-0042/ }).click();

  await expect(page.getByTestId('litigation-counsel-link')).toHaveText('PTY-2026-0042');
  await expect(page.getByTestId('litigation-counsel-link')).toHaveAttribute(
    'href',
    `/party?record=${COUNSEL_PARTY_ID}`
  );
  expect(state.searchRequests).toHaveLength(1);
  expect(state.searchRequests[0]).toEqual({
    query: 'Ridgeline',
    limit: '8',
    tenant: TENANT,
    book: undefined
  });

  await fillRequiredMatterFields(page);
  await page.getByLabel('Damages sought amount').fill('1250000');
  await page.getByLabel('Damages sought currency').fill('usd');
  await expect(page.getByTestId('litigation-damages-detail')).toContainText(
    'Pleaded USD 1,250,000.00.'
  );
  await page.getByRole('button', { name: 'Open litigation matter' }).click();

  await expect(page.getByTestId(`litigation-damages-${MATTER_ID}`)).toHaveText(
    'USD 1,250,000.00'
  );
  await expect(page.getByTestId(`litigation-counsel-${MATTER_ID}`)).toHaveText(
    'Ridgeline & Associates · PTY-2026-0042'
  );
  await expect(page.getByTestId(`litigation-counsel-${MATTER_ID}`)).toHaveAttribute(
    'href',
    `/party?record=${COUNSEL_PARTY_ID}`
  );

  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).toMatchObject({
    counselPartyId: COUNSEL_PARTY_ID,
    jurisdiction: 'US-OH',
    caseNumber: 'CASE-2026-0042',
    damagesSought: '1250000',
    damagesCurrency: 'USD'
  });
  expect(state.createBodies[0]).not.toHaveProperty('counselPartyLabel');
  expect(state.createHeaders[0]['x-eia-book']).toBe('DIRECT');
  expect(state.createHeaders[0]['x-eia-tenant']).toBe(TENANT);
});

test('requires the damages amount and currency together, positive, and omits an empty pair', async ({
  page
}) => {
  const state = await installMocks(page);
  await openLitigation(page);
  await selectCounsel(page);
  await fillRequiredMatterFields(page);

  const amount = page.getByLabel('Damages sought amount');
  const currency = page.getByLabel('Damages sought currency');
  const submit = page.getByRole('button', { name: 'Open litigation matter' });

  await amount.fill('500000');
  await submit.click();
  await expect(page.getByTestId('litigation-form-error')).toContainText(
    'Enter the damages sought currency when a damages amount is entered.'
  );
  expect(state.createBodies).toHaveLength(0);

  await amount.fill('');
  await currency.fill('USD');
  await submit.click();
  await expect(page.getByTestId('litigation-form-error')).toContainText(
    'Enter the damages sought amount when a damages currency is selected.'
  );
  expect(state.createBodies).toHaveLength(0);

  await amount.fill('0');
  await submit.click();
  await expect(page.getByTestId('litigation-form-error')).toContainText(
    'Damages sought amount must be a positive number.'
  );
  expect(state.createBodies).toHaveLength(0);

  await amount.fill('-5');
  await submit.click();
  await expect(page.getByTestId('litigation-form-error')).toContainText(
    'Damages sought amount must be a positive number.'
  );
  expect(state.createBodies).toHaveLength(0);

  await amount.fill('500000');
  await currency.fill('US');
  await submit.click();
  await expect(page.getByTestId('litigation-form-error')).toContainText(
    'Damages sought currency must be a three-letter ISO 4217 code.'
  );
  expect(state.createBodies).toHaveLength(0);

  await amount.fill('');
  await currency.fill('');
  await submit.click();

  await expect(page.getByTestId(`litigation-damages-${MATTER_ID}`)).toHaveText('—');
  expect(state.createBodies).toHaveLength(1);
  expect(state.createBodies[0]).not.toHaveProperty('damagesSought');
  expect(state.createBodies[0]).not.toHaveProperty('damagesCurrency');
});

test('shows pleaded damages, the counsel party link, and the context on a saved matter', async ({
  page
}) => {
  await installMocks(page, {
    matters: [
      makeMatter({
        damagesSought: '2500000.0000',
        damagesCurrency: 'USD'
      })
    ]
  });
  await openLitigation(page);

  await expect(page.getByTestId(`litigation-counsel-${MATTER_ID}`)).toHaveText(
    'Ridgeline & Associates · PTY-2026-0042'
  );
  await expect(page.getByTestId(`litigation-counsel-${MATTER_ID}`)).toHaveAttribute(
    'href',
    `/party?record=${COUNSEL_PARTY_ID}`
  );
  await expect(page.getByTestId(`litigation-damages-${MATTER_ID}`)).toHaveText(
    'USD 2,500,000.00'
  );
  await expect(page.getByTestId('litigation-damages-note')).toContainText('pleaded');

  const context = page.getByTestId('litigation-context');
  await expect(context).toContainText('Counsel is a party record.');
  await expect(context).toContainText('Damages sought is the pleaded amount.');
  await expect(context).toContainText('not the claim reserve, the settlement authority, or a payment');
});
