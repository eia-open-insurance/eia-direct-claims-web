import { test, expect } from '@playwright/test';

const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d31';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

const BASE_CLAIM = {
  id: CLAIM_ID,
  tenantId: '11111111-1111-7111-8111-111111111111',
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000101',
  policyId: POLICY_ID,
  claimantPartyId: PARTY_ID,
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  claimType: 'BODILY_INJURY',
  reserveAmount: 125000,
  currentReserveAmount: 125000,
  reserveCurrency: 'USD',
  version: 0,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

async function installClaimMock(page, options = {}) {
  const state = {
    claim: { ...BASE_CLAIM, ...(options.claim || {}) },
    coverage: options.coverage || null,
    reserves: options.reserves || {
      totalCurrentAmount: 0,
      currency: 'USD',
      components: [],
      history: []
    },
    litigation: options.litigation || [],
    settlements: options.settlements || [],
    recoveries: options.recoveries || []
  };

  await page.route('**/api/v1/claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/v1/claims') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([state.claim])
      });
    }

    const match = url.pathname.match(
      /\/claims\/[^/]+\/(coverage|reserves|litigation|settlements|recoveries)$/
    );
    if (request.method() === 'GET' && match) {
      const resource = match[1];
      if (resource === 'coverage' && !state.coverage) {
        return route.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ message: 'No coverage decision recorded' })
        });
      }
      const body = resource === 'coverage'
        ? state.coverage
        : resource === 'reserves'
          ? state.reserves
          : state[resource];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    }

    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route(/\/api\/v1\/policies\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: POLICY_ID, policyNumber: 'POL-2026-0001', productCode: 'GL' })
    });
  });

  await page.route(/\/api\/v1\/parties\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: PARTY_ID,
        displayName: 'Meridian Manufacturing',
        partyNumber: 'PTY-2026-0001'
      })
    });
  });

  return state;
}

function step(page, id) {
  return page.getByTestId(`process-step-${id}`);
}

test('renders FNOL as complete and Coverage as the current step for a registered claim', async ({ page }) => {
  await installClaimMock(page, { claim: { status: 'REGISTERED' } });

  await page.goto('/');

  const stepper = page.getByTestId('claim-progress');
  await expect(stepper).toBeVisible();
  await expect(stepper.getByRole('heading', { name: 'Claim progress' })).toBeVisible();
  await expect(page.locator('.eia-process-label')).toHaveText([
    'FNOL',
    'Coverage',
    'Reserving',
    'Investigation',
    'Settlement',
    'Payment',
    'Closed'
  ]);
  await expect(page.locator('.eia-process-purpose')).toHaveCount(7);
  await expect(page.getByTestId('process-stage')).toHaveText('Coverage · step 2 of 7');

  await expect(step(page, 'fnol')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'fnol')).toHaveAttribute('data-complete', 'true');
  await expect(step(page, 'coverage')).toHaveAttribute('data-state', 'current');
  await expect(step(page, 'coverage')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'reserving')).toHaveAttribute('data-state', 'upcoming');
  await expect(step(page, 'closed')).toHaveAttribute('data-state', 'upcoming');

  await expect(page.getByTestId('process-next')).toContainText(
    'Review the policy terms, limits, and exclusions, then record the coverage position.'
  );

  // The existing record tabs and actions stay in place below the stepper.
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reserve History' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close claim' })).toBeEnabled();
});

test('maps coverage, reserves, litigation, and settlement records to an in-settlement claim', async ({ page }) => {
  await installClaimMock(page, {
    claim: { status: 'IN_SETTLEMENT', currentReserveAmount: 500000 },
    coverage: {
      position: 'COVERED',
      status: 'DECIDED',
      basis: 'Occurrence within the policy period.',
      decisionDate: '2026-04-01'
    },
    reserves: {
      totalCurrentAmount: 500000,
      currency: 'USD',
      components: [{ component: 'INDEMNITY', currentAmount: 500000, currency: 'USD' }],
      history: [
        {
          id: 'reserve-1',
          sequence: 1,
          component: 'INDEMNITY',
          amount: 500000,
          currency: 'USD',
          reasonCode: 'INITIAL',
          effectiveDate: '2026-04-01',
          current: true
        }
      ]
    },
    litigation: [
      {
        id: 'litigation-1',
        matterType: 'DEFENSE',
        jurisdiction: 'NY',
        filingDate: '2026-04-15',
        status: 'ACTIVE'
      }
    ],
    settlements: [
      {
        id: 'settlement-1',
        settlementNumber: 'SET-2026-0001',
        amount: 300000,
        currency: 'USD',
        structure: 'LUMP_SUM',
        status: 'PROPOSED'
      }
    ]
  });

  await page.goto('/');
  await expect(page.getByTestId('claim-progress')).toBeVisible();

  await expect(step(page, 'fnol')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'coverage')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'reserving')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'investigation')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'settlement')).toHaveAttribute('data-state', 'current');
  await expect(step(page, 'settlement')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'payment')).toHaveAttribute('data-state', 'upcoming');
  await expect(step(page, 'closed')).toHaveAttribute('data-state', 'upcoming');
  await expect(page.getByTestId('process-stage')).toHaveText('Settlement · step 5 of 7');
  await expect(page.getByTestId('process-next')).toContainText(
    'Negotiate and approve the proposed settlement; approval moves the claim to payment.'
  );

  // Existing summary and tab data are unchanged by the new stepper.
  await expect(page.getByTestId('summary-current-reserve')).toHaveText(/500,000\.00/);
  await page.getByRole('tab', { name: 'Coverage' }).click();
  await expect(page.getByTestId('coverage-position')).toHaveText('COVERED');
});

test('marks a denied coverage decision and explains the denial next step', async ({ page }) => {
  await installClaimMock(page, {
    claim: { status: 'DENIED' },
    coverage: {
      position: 'DENIED',
      status: 'DECIDED',
      basis: 'Loss falls outside the pollution exclusion.',
      decisionDate: '2026-04-03'
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('claim-progress')).toBeVisible();

  await expect(step(page, 'fnol')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'coverage')).toHaveAttribute('data-state', 'denied');
  await expect(step(page, 'coverage')).toHaveAttribute('data-current', 'true');
  await expect(step(page, 'coverage')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'reserving')).toHaveAttribute('data-state', 'upcoming');
  await expect(page.getByTestId('process-stage')).toHaveText('Coverage · step 2 of 7');
  await expect(page.getByTestId('process-next')).toContainText('Coverage is denied');
});

test('shows every phase closed and keeps the record available for a closed claim', async ({ page }) => {
  await installClaimMock(page, {
    claim: { status: 'CLOSED' },
    settlements: [
      {
        id: 'settlement-1',
        settlementNumber: 'SET-2026-0001',
        amount: 300000,
        currency: 'USD',
        structure: 'LUMP_SUM',
        status: 'PAID'
      }
    ]
  });

  await page.goto('/');
  await expect(page.getByTestId('claim-progress')).toBeVisible();

  await expect(step(page, 'fnol')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'payment')).toHaveAttribute('data-state', 'completed');
  await expect(step(page, 'closed')).toHaveAttribute('data-state', 'current');
  await expect(step(page, 'closed')).toHaveAttribute('data-complete', 'true');
  await expect(step(page, 'closed')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('process-next')).toContainText('The claim is closed');
  await expect(page.getByRole('button', { name: 'Closed', exact: true })).toBeDisabled();
});
