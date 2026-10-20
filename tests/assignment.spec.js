import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e01';
const SECOND_CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e02';
const THIRD_CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e03';

const BASE_CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000201',
  policyId: '22222222-2222-7222-8222-222222222222',
  claimantPartyId: '33333333-3333-7333-8333-333333333333',
  claimType: 'BODILY_INJURY',
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '125000.0000',
  reserveCurrency: 'USD',
  currentReserveAmount: '125000.0000',
  version: 0,
  createdAt: '2026-03-18T09:00:00Z',
  updatedAt: '2026-03-18T09:00:00Z'
};

function makeClaim(overrides = {}) {
  return { ...BASE_CLAIM, ...overrides };
}

function newState(claim, claims = [claim], extra = {}) {
  return {
    claim,
    claims,
    patches: [],
    listCalls: 0,
    detailCalls: 0,
    staleOnce: false,
    ...extra
  };
}

async function installClaimApi(page, state) {
  await page.route('**/api/v1/claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fulfill = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (request.method() === 'GET' && url.pathname === '/api/v1/claims') {
      state.listCalls += 1;
      return fulfill(200, state.claims);
    }

    if (
      request.method() === 'PATCH' &&
      url.pathname === `/api/v1/claims/${state.claim.id}/assignment`
    ) {
      const body = request.postDataJSON();
      state.patches.push({
        body,
        path: url.pathname,
        book: request.headers()['x-eia-book'],
        actor: request.headers()['x-eia-actor']
      });

      if (state.staleOnce) {
        state.staleOnce = false;
        const conflicting = {
          ...state.claim,
          assignedAdjuster: 'Morgan Supervisor',
          assignedTeam: 'SUPERVISORY',
          assignedAt: '2026-03-18T10:00:00Z',
          version: state.claim.version + 1
        };
        state.claim = conflicting;
        state.claims = state.claims.map((row) => (row.id === conflicting.id ? conflicting : row));
        return fulfill(409, {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'STALE_VERSION',
          message: 'Claim version is stale'
        });
      }

      const updated = {
        ...state.claim,
        assignedAdjuster: body.assignedAdjuster,
        assignedTeam: body.assignedTeam,
        assignedAt: '2026-03-18T10:05:00Z',
        version: state.claim.version + 1,
        updatedAt: '2026-03-18T10:05:00Z'
      };
      state.claim = updated;
      state.claims = state.claims.map((row) => (row.id === updated.id ? updated : row));
      return fulfill(200, updated);
    }

    if (
      request.method() === 'GET' &&
      url.pathname === `/api/v1/claims/${state.claim.id}`
    ) {
      state.detailCalls += 1;
      return fulfill(200, state.claim);
    }

    // Coverage, reserves, litigation, settlements, recoveries, and tasks.
    if (request.method() === 'GET') return fulfill(200, []);
    return fulfill(200, {});
  });

  await page.route('**/api/v1/policies/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/v1/parties/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  );
}

test('assigns a claim with expectedVersion and refreshes header, summary, and queue', async ({ page }) => {
  const state = newState(makeClaim());
  await installClaimApi(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: BASE_CLAIM.claimNumber })).toBeVisible();

  // Unassigned ownership is explicit everywhere the record shows an owner.
  await expect(page.getByTestId('record-assignment')).toHaveText('Unassigned');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('Unassigned');
  await expect(page.getByTestId('summary-assigned-team')).toHaveText('Ownership queue');
  await expect(page.getByTestId('queue-assignee')).toHaveText('Unassigned');

  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Assign claim' })).toBeVisible();
  await expect(dialog.getByTestId('assignment-assigned-adjuster')).toHaveValue('A. Adjuster');
  await expect(dialog.getByTestId('assignment-assigned-team')).toHaveValue('DIRECT_CLAIMS');
  await expect(dialog.getByTestId('assignment-context')).toContainText(
    /does not change\s+coverage, reserves, settlements, payments/i
  );

  await dialog.getByTestId('assignment-assigned-adjuster').fill('Jordan Blake');
  await dialog.getByTestId('assignment-assigned-team').selectOption('MAJOR_LOSS');
  await dialog.getByRole('button', { name: 'Assign claim' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('record-assignment')).toContainText('Assigned to Jordan Blake');
  await expect(page.getByTestId('record-assignment')).toContainText('MAJOR_LOSS');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('Jordan Blake');
  await expect(page.getByTestId('summary-assigned-team')).toHaveText('MAJOR_LOSS');
  await expect(page.getByTestId('queue-assignee')).toContainText('Jordan Blake');
  await expect(page.getByRole('status')).toContainText('assigned to Jordan Blake');

  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].path).toBe(`/api/v1/claims/${CLAIM_ID}/assignment`);
  expect(state.patches[0].body).toEqual({
    assignedAdjuster: 'Jordan Blake',
    assignedTeam: 'MAJOR_LOSS',
    expectedVersion: 0
  });
  expect(state.patches[0].book).toBe('DIRECT');
  expect(state.patches[0].actor).toBe('A. Adjuster');

  // The successful assignment refreshes both the queue and the claim detail.
  expect(state.listCalls).toBeGreaterThanOrEqual(2);
  expect(state.detailCalls).toBeGreaterThanOrEqual(1);
});

test('pre-fills the current assignment when reassigning a claim', async ({ page }) => {
  const state = newState(
    makeClaim({
      assignedAdjuster: 'Jordan Blake',
      assignedTeam: 'MAJOR_LOSS',
      assignedAt: '2026-03-18T09:30:00Z',
      version: 2
    })
  );
  await installClaimApi(page, state);

  await page.goto('/');
  await expect(page.getByTestId('record-assignment')).toContainText('Assigned to Jordan Blake');
  await expect(page.getByTestId('record-assignment')).toContainText('MAJOR_LOSS');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('Jordan Blake');
  await expect(page.getByTestId('queue-assignee')).toContainText('Assigned to Jordan Blake · MAJOR_LOSS');
  await expect(page.getByTestId('overview-assignment')).toHaveText('Jordan Blake · MAJOR_LOSS');

  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('assignment-current')).toContainText(
    'Current owner Jordan Blake · MAJOR_LOSS'
  );
  await expect(dialog.getByTestId('assignment-assigned-adjuster')).toHaveValue('Jordan Blake');
  await expect(dialog.getByTestId('assignment-assigned-team')).toHaveValue('MAJOR_LOSS');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(state.patches).toHaveLength(0);
});

test('filters the claim queue by assignee and team', async ({ page }) => {
  const directClaim = makeClaim({
    assignedAdjuster: 'A. Adjuster',
    assignedTeam: 'DIRECT_CLAIMS'
  });
  const majorLossClaim = makeClaim({
    id: SECOND_CLAIM_ID,
    claimNumber: 'CLM-2026-0000202',
    assignedAdjuster: 'Jordan Blake',
    assignedTeam: 'MAJOR_LOSS'
  });
  const unassignedClaim = makeClaim({
    id: THIRD_CLAIM_ID,
    claimNumber: 'CLM-2026-0000203'
  });
  const state = newState(directClaim, [directClaim, majorLossClaim, unassignedClaim]);
  await installClaimApi(page, state);

  await page.goto('/');
  const directButton = page.getByRole('button', { name: /CLM-2026-0000201/ });
  const majorLossButton = page.getByRole('button', { name: /CLM-2026-0000202/ });
  const unassignedButton = page.getByRole('button', { name: /CLM-2026-0000203/ });
  const filter = page.getByTestId('claim-filter');

  await expect(directButton).toBeVisible();
  await expect(majorLossButton).toBeVisible();
  await expect(unassignedButton).toBeVisible();

  await filter.fill('Jordan');
  await expect(majorLossButton).toBeVisible();
  await expect(directButton).toBeHidden();
  await expect(unassignedButton).toBeHidden();
  await expect(page.getByTestId('claim-queue-count')).toHaveText('1 of 3');

  await filter.fill('MAJOR_LOSS');
  await expect(majorLossButton).toBeVisible();
  await expect(directButton).toBeHidden();

  await filter.fill('direct claims');
  await expect(directButton).toBeVisible();
  await expect(majorLossButton).toBeHidden();

  await filter.fill('unassigned');
  await expect(unassignedButton).toBeVisible();
  await expect(directButton).toBeHidden();
  await expect(majorLossButton).toBeHidden();
});

test('keeps the dialog open with a reload message when the claim is stale', async ({ page }) => {
  const claim = makeClaim({
    assignedAdjuster: 'Jordan Blake',
    assignedTeam: 'MAJOR_LOSS',
    assignedAt: '2026-03-18T09:30:00Z',
    version: 2
  });
  const state = newState(claim, [claim], { staleOnce: true });
  await installClaimApi(page, state);

  await page.goto('/');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('assignment-assigned-adjuster').fill('Riley Adjuster');
  await dialog.getByTestId('assignment-assigned-team').selectOption('RECOVERY');
  await dialog.getByRole('button', { name: 'Assign claim' }).click();

  const stale = dialog.getByTestId('assignment-stale');
  await expect(stale).toBeVisible();
  await expect(stale).toContainText(/reload the claim/i);
  await expect(stale).toContainText(/claim version is stale/i);
  expect(state.patches[0].body).toEqual({
    assignedAdjuster: 'Riley Adjuster',
    assignedTeam: 'RECOVERY',
    expectedVersion: 2
  });

  await dialog.getByRole('button', { name: 'Reload claim' }).click();
  await expect(dialog.getByTestId('assignment-status')).toContainText('Claim reloaded at version 3');
  await expect(dialog.getByTestId('assignment-current')).toContainText(
    'Current owner Morgan Supervisor · SUPERVISORY'
  );
  await expect(stale).toBeHidden();
  await expect(dialog.getByTestId('assignment-assigned-adjuster')).toHaveValue('Riley Adjuster');

  await dialog.getByRole('button', { name: 'Assign claim' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('record-assignment')).toContainText('Riley Adjuster');
  await expect(page.getByTestId('record-assignment')).toContainText('RECOVERY');

  expect(state.patches).toHaveLength(2);
  expect(state.patches[1].body).toEqual({
    assignedAdjuster: 'Riley Adjuster',
    assignedTeam: 'RECOVERY',
    expectedVersion: 3
  });
  expect(state.listCalls).toBeGreaterThanOrEqual(2);
  expect(state.detailCalls).toBeGreaterThanOrEqual(2);
});
