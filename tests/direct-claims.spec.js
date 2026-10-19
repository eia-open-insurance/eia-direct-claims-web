import { test, expect } from '@playwright/test';

const EXISTING = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21',
  tenantId: '11111111-1111-7111-8111-111111111111',
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000001',
  policyId: '22222222-2222-7222-8222-222222222222',
  claimantPartyId: '33333333-3333-7333-8333-333333333333',
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: 125000.0,
  reserveCurrency: 'USD',
  version: 0,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

test('renders the Direct Claims workbench, sends the DIRECT book header, and registers a claim', async ({ page }) => {
  let claims = [EXISTING];
  const bookHeaders = [];

  await page.route('**/api/v1/claims', async (route) => {
    const request = route.request();
    bookHeaders.push(request.headers()['x-eia-book']);

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(claims)
      });
      return;
    }

    const payload = request.postDataJSON();
    const created = {
      ...payload,
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d22',
      tenantId: '11111111-1111-7111-8111-111111111111',
      businessBook: 'DIRECT',
      claimNumber: 'CLM-2026-0000002',
      status: 'REGISTERED',
      version: 0,
      createdAt: '2026-03-18T09:05:00Z',
      updatedAt: '2026-03-18T09:05:00Z'
    };
    claims = [created, ...claims];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created)
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Direct Claims' })).toBeVisible();
  await expect(page.getByText('Book: DIRECT')).toBeVisible();
  await expect(page.getByText('CLM-2026-0000001')).toBeVisible();

  await page.getByLabel('Policy ID').fill('22222222-2222-7222-8222-222222222222');
  await page.getByLabel('Claimant party ID').fill('33333333-3333-7333-8333-333333333333');
  await page.getByLabel('Loss date').fill('2026-04-01');
  await page.getByLabel('Report date').fill('2026-04-02');
  await page.getByLabel('Cause code').fill('GL');
  await page.getByLabel('Reserve amount').fill('250000');
  await page.getByRole('button', { name: 'Register claim' }).click();

  await expect(page.getByText('CLM-2026-0000002')).toBeVisible();
  expect(bookHeaders.length).toBeGreaterThan(1);
  expect(bookHeaders.every((value) => value === 'DIRECT')).toBeTruthy();
});
