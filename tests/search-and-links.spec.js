import { test, expect } from '@playwright/test';

const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const OTHER_POLICY_ID = '22222222-2222-7222-8222-222222222223';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const CLAIM_A = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21',
  tenantId: '11111111-1111-7111-8111-111111111111',
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
  version: 0,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

const CLAIM_B = {
  ...CLAIM_A,
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d22',
  claimNumber: 'CLM-2026-0000002',
  policyId: OTHER_POLICY_ID,
  claimType: 'MASS_TORT',
  status: 'IN_LITIGATION',
  causeCode: 'AUTO',
  reserveAmount: '480000.0000',
  currentReserveAmount: '480000.0000'
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the claim queue and every claim-detail route. `detail` maps an id to the
 * record returned by GET /api/v1/claims/{id}; unknown ids return 404.
 */
async function mockClaims(page, { queue = [], detail = {}, onDetail } = {}) {
  let rows = [...queue];

  await page.route('**/api/v1/claims', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await fulfillJson(route, rows);
      return;
    }
    const payload = request.postDataJSON();
    const created = {
      ...payload,
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d99',
      tenantId: '11111111-1111-7111-8111-111111111111',
      businessBook: 'DIRECT',
      claimNumber: 'CLM-2026-0000099',
      status: 'REGISTERED',
      version: 0
    };
    rows = [created, ...rows];
    await fulfillJson(route, created, 201);
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (onDetail) onDetail(request, url);
    const marker = '/api/v1/claims/';
    const rest = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    const [id, section] = rest.split('/');

    if (request.method() === 'GET' && !section && detail[id]) {
      await fulfillJson(route, detail[id]);
      return;
    }
    if (request.method() === 'GET' && (section === 'settlements' || section === 'recoveries')) {
      await fulfillJson(route, []);
      return;
    }
    if (request.method() === 'GET') {
      await fulfillJson(route, []);
      return;
    }
    await fulfillJson(route, {});
  });
}

test('?record= selects the requested claim and popstate re-applies it', async ({ page }) => {
  const detailRequests = [];
  await mockClaims(page, {
    queue: [CLAIM_A],
    detail: { [CLAIM_B.id]: CLAIM_B },
    onDetail: (request, url) => {
      if (url.pathname === `/api/v1/claims/${CLAIM_B.id}`) {
        detailRequests.push({
          method: request.method(),
          book: request.headers()['x-eia-book']
        });
      }
    }
  });

  await page.goto(`/?record=${CLAIM_B.id}`);

  await expect(page.getByRole('heading', { name: CLAIM_B.claimNumber })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000002/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /CLM-2026-0000001/ })).toBeVisible();
  expect(detailRequests).toEqual([{ method: 'GET', book: 'DIRECT' }]);

  await page.evaluate((id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('record', id);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, CLAIM_A.id);

  await expect(page.getByRole('heading', { name: CLAIM_A.claimNumber })).toBeVisible();
});

test('?new=1 opens the Register claim dialog', async ({ page }) => {
  await mockClaims(page, { queue: [CLAIM_A] });

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Register claim' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('filters the claim queue by number, type, cause, and status', async ({ page }) => {
  await mockClaims(page, { queue: [CLAIM_A, CLAIM_B] });

  await page.goto('/');
  const queue = page.locator('aside[aria-label="Direct claim queue"]');
  const filter = page.getByPlaceholder('Filter claims by number, type, cause, or status…');
  const claimA = queue.getByRole('button', { name: /CLM-2026-0000001/ });
  const claimB = queue.getByRole('button', { name: /CLM-2026-0000002/ });

  await expect(claimA).toBeVisible();
  await expect(claimB).toBeVisible();

  for (const term of ['MASS_TORT', 'AUTO', 'IN_LITIGATION', 'CLM-2026-0000002']) {
    await filter.fill(term);
    await expect(claimB).toBeVisible();
    await expect(claimA).toHaveCount(0);
  }

  await filter.fill('CLM-2026-0000001');
  await expect(claimA).toBeVisible();
  await expect(claimB).toHaveCount(0);
  await expect(page.getByTestId('claim-queue-count')).toHaveText('1 of 2');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(claimA).toBeVisible();
  await expect(claimB).toBeVisible();
});

test('policy and party pickers submit the selected UUIDs', async ({ page }) => {
  const pickerRequests = [];
  let createBody = null;
  await mockClaims(page, { queue: [CLAIM_A] });

  await page.route('**/api/v1/policies/search**', async (route) => {
    pickerRequests.push({
      path: new URL(route.request().url()).pathname,
      book: route.request().headers()['x-eia-book']
    });
    await fulfillJson(route, {
      query: 'POL',
      limit: 8,
      items: [
        {
          id: POLICY_ID,
          type: 'POLICY',
          label: 'POL-2026-0001',
          secondary: 'GL · ACTIVE',
          status: 'ACTIVE',
          href: `/policy?record=${POLICY_ID}`
        }
      ]
    });
  });
  await page.route('**/api/v1/parties/search**', async (route) => {
    await fulfillJson(route, {
      query: 'PTY',
      limit: 8,
      items: [
        {
          id: PARTY_ID,
          type: 'PARTY',
          label: 'PTY-2026-0001',
          secondary: 'Meridian Manufacturing · ORGANIZATION',
          status: 'ACTIVE',
          href: `/party?record=${PARTY_ID}`
        }
      ]
    });
  });
  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, [CLAIM_A]);
      return;
    }
    createBody = route.request().postDataJSON();
    await fulfillJson(route, {
      ...createBody,
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d99',
      businessBook: 'DIRECT',
      claimNumber: 'CLM-2026-0000099',
      status: 'REGISTERED',
      version: 0
    }, 201);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register claim' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByPlaceholder('Search policy number or product…').fill('POL-2026');
  await dialog.getByRole('button', { name: /POL-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open policy record' })).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(dialog.getByText('GL · ACTIVE', { exact: false })).toBeVisible();

  await dialog.getByPlaceholder('Search party number or name…').fill('PTY-2026');
  await dialog.getByRole('button', { name: /PTY-2026-0001/ }).click();
  await expect(dialog.getByRole('link', { name: 'Open claimant party record' })).toHaveAttribute(
    'href',
    `/party?record=${PARTY_ID}`
  );
  await expect(dialog.getByText('Meridian Manufacturing · ORGANIZATION', { exact: false })).toBeVisible();

  await dialog.getByLabel('Loss date').fill('2026-04-01');
  await dialog.getByLabel('Report date').fill('2026-04-02');
  await dialog.getByLabel('Cause code').fill('GL');
  await dialog.getByLabel('Reserve amount').fill('250000');
  await dialog.getByRole('button', { name: 'Register claim' }).click();

  await expect(dialog).toBeHidden();
  expect(createBody.policyId).toBe(POLICY_ID);
  expect(createBody.claimantPartyId).toBe(PARTY_ID);
  expect(pickerRequests).toEqual([{ path: '/api/v1/policies/search', book: 'DIRECT' }]);
});

test('overview carries policy/claimant cross-links, why-it-matters context, and related cessions', async ({ page }) => {
  let cessionRequest = null;
  await mockClaims(page, { queue: [CLAIM_A] });
  await page.route('**/api/v1/cessions/search**', async (route) => {
    const url = new URL(route.request().url());
    cessionRequest = {
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit'),
      book: route.request().headers()['x-eia-book']
    };
    await fulfillJson(route, {
      query: POLICY_ID,
      limit: 5,
      items: [
        {
          id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d55',
          type: 'CESSION',
          label: 'CES-2026-0009',
          secondary: 'DIRECT · OPEN',
          status: 'OPEN',
          href: '/cession?record=0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d55'
        }
      ]
    });
  });

  await page.goto('/');

  await expect(page.getByTestId('overview-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByTestId('overview-claimant-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY_ID}`
  );

  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  await expect(page.getByText(/policy controls coverage/i)).toBeVisible();
  await expect(page.getByText(/cessions and reinsurance recoveries are derived from the policy/i)).toBeVisible();
  await expect(page.getByText(/reserves and settlements recorded here drive payment instructions/i)).toBeVisible();

  await expect(page.getByTestId('related-policy-link')).toHaveAttribute(
    'href',
    `/policy?record=${POLICY_ID}`
  );
  await expect(page.getByRole('link', { name: /CES-2026-0009/ })).toHaveAttribute(
    'href',
    '/cession?record=0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d55'
  );
  expect(cessionRequest).toEqual({ q: POLICY_ID, limit: '5', book: 'DIRECT' });
});
