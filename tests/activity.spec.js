import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_A_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d61';
const CLAIM_B_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d62';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

function makeClaim(id, claimNumber) {
  return {
    id,
    tenantId: TENANT,
    businessBook: 'DIRECT',
    claimNumber,
    policyId: POLICY_ID,
    claimantPartyId: PARTY_ID,
    claimType: 'BODILY_INJURY',
    status: 'OPEN',
    lossDate: '2026-03-14',
    reportDate: '2026-03-18',
    causeCode: 'GL',
    reserveAmount: '125000.0000',
    currentReserveAmount: '125000.0000',
    reserveCurrency: 'USD',
    version: 1,
    createdAt: '2026-03-18T09:00:00Z',
    updatedAt: '2026-03-24T09:00:00Z'
  };
}

const CLAIM_A = makeClaim(CLAIM_A_ID, 'CLM-2026-0000201');
const CLAIM_B = makeClaim(CLAIM_B_ID, 'CLM-2026-0000202');

function makeEvent({
  eventId,
  eventType,
  aggregateId = CLAIM_A_ID,
  aggregateVersion = 0,
  occurredAt,
  receivedAt = occurredAt,
  status = 'PROCESSED',
  eventVersion = 1,
  payload = {}
}) {
  return {
    eventId,
    eventType,
    eventVersion,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'CLAIM',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt,
    status,
    payload
  };
}

// Deliberately ascending: the workbench must present the newest event first.
const ACTIVITY_EVENTS = [
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e01',
    eventType: 'direct.claim.registered',
    aggregateVersion: 0,
    occurredAt: '2026-03-18T09:00:00Z',
    payload: {
      claimId: CLAIM_A_ID,
      claimNumber: CLAIM_A.claimNumber,
      status: 'REGISTERED',
      reserveAmount: '125000.0000',
      reserveCurrency: 'USD'
    }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e02',
    eventType: 'direct.claim.updated',
    aggregateVersion: 1,
    occurredAt: '2026-03-19T10:15:00Z',
    payload: { changedFields: ['status'], from: 'REGISTERED', to: 'OPEN' }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e03',
    eventType: 'direct.claim.reserve-changed',
    aggregateVersion: 2,
    occurredAt: '2026-03-20T11:30:00Z',
    payload: {
      reserveEntryId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9f01',
      component: 'INDEMNITY',
      amount: '25000.0000',
      currency: 'USD',
      previousAmount: '100000.0000',
      deltaAmount: '25000.0000',
      totalCurrentReserveAmount: '125000.0000',
      sequence: 2
    }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e04',
    eventType: 'direct.claim.coverage-assessed',
    aggregateVersion: 3,
    occurredAt: '2026-03-21T12:45:00Z',
    payload: { position: 'COVERED', coverageStatus: 'DECIDED', coverageVersion: 0 }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e05',
    eventType: 'direct.claim.settlement-authorized',
    aggregateVersion: 4,
    occurredAt: '2026-03-22T13:00:00Z',
    payload: {
      settlementNumber: 'STL-2026-0001',
      settlementAmount: '75000.0000',
      settlementCurrency: 'USD',
      settlementStatus: 'AUTHORIZED'
    }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e06',
    eventType: 'direct.claim.task-created',
    aggregateVersion: 5,
    occurredAt: '2026-03-23T14:10:00Z',
    payload: {
      taskNumber: 'TSK-2026-0001',
      title: 'Obtain updated medical records',
      status: 'OPEN',
      priority: 'HIGH'
    }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e07',
    eventType: 'direct.claim.note-added',
    aggregateVersion: 6,
    occurredAt: '2026-03-24T15:20:00Z',
    payload: {
      noteNumber: 'NOT-2026-0001',
      noteType: 'DIARY',
      body: 'Spoke with the claimant about the medical authorization.',
      author: 'Dana Handler'
    }
  }),
  makeEvent({
    eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e08',
    eventType: 'direct.claim.payment-requested',
    aggregateVersion: 7,
    occurredAt: '2026-03-25T16:30:00Z',
    payload: { sourceType: 'DIRECT_CLAIM', sourceReference: CLAIM_A.claimNumber }
  })
];

const EXPECTED_LABELS = [
  'Payment requested',
  'Note added',
  'Diary task created',
  'Settlement authorized',
  'Coverage assessed',
  'Reserve changed',
  'Claim updated',
  'Claim registered'
];

const EXTRA_EVENT = makeEvent({
  eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9e09',
  eventType: 'direct.claim.closed',
  aggregateVersion: 8,
  occurredAt: '2026-03-26T17:00:00Z',
  payload: { from: 'OPEN', to: 'CLOSED', finalReserveAmount: '0.0000', reserveCurrency: 'USD' }
});

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function fulfillProblem(route, status, detail) {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Service Unavailable', status, detail })
  });
}

/**
 * Mocks the claim queue, every claim sub-resource the record header loads, the
 * platform event aggregate endpoint, and the policy/party label lookups.
 */
async function installMocks(page) {
  const state = {
    claims: [{ ...CLAIM_A }, { ...CLAIM_B }],
    events: ACTIVITY_EVENTS.map((event) => ({ ...event })),
    eventsByAggregate: null,
    eventsProblem: null,
    eventsHold: null,
    releaseEvents: null,
    eventRequests: []
  };

  await page.route('**/api/v1/claims', async (route) => {
    await fulfillJson(route, state.claims);
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() !== 'GET') {
      await fulfillJson(route, {});
      return;
    }

    if (url.pathname.endsWith('/coverage')) {
      await fulfillProblem(route, 404, 'No coverage decision recorded');
      return;
    }
    if (url.pathname.endsWith('/reserves')) {
      await fulfillJson(route, {
        totalCurrentAmount: '0.0000',
        currency: 'USD',
        components: [],
        history: []
      });
      return;
    }
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const aggregateId = decodeURIComponent(url.pathname.split('/').pop());

    state.eventRequests.push({
      method: request.method(),
      path: url.pathname,
      aggregateId,
      limit: url.searchParams.get('limit'),
      tenant: request.headers()['x-eia-tenant'],
      book: request.headers()['x-eia-book']
    });

    if (state.eventsHold) await state.eventsHold;
    if (state.eventsProblem) {
      await fulfillProblem(route, state.eventsProblem.status, state.eventsProblem.detail);
      return;
    }

    const items = state.eventsByAggregate
      ? state.eventsByAggregate[aggregateId] || []
      : state.events;
    await fulfillJson(route, {
      aggregateId,
      limit: 50,
      items
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

  await page.route('**/api/v1/cessions/search**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/documents**', async (route) => {
    await fulfillJson(route, { items: [] });
  });

  return state;
}

async function openActivity(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM_A.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
}

function itemFor(page, label) {
  return page.getByTestId('activity-item').filter({ hasText: label });
}

test('renders claim events newest first with human labels, status, version, and raw type', async ({ page }) => {
  await installMocks(page);
  await openActivity(page);

  await expect(page.getByTestId('activity-item')).toHaveCount(ACTIVITY_EVENTS.length);
  expect(await page.getByTestId('activity-label').allTextContents()).toEqual(EXPECTED_LABELS);

  // The API returned oldest-first; the timeline is newest-first.
  const times = await page
    .getByTestId('activity-time')
    .evaluateAll((nodes) => nodes.map((node) => Date.parse(node.getAttribute('datetime'))));
  expect(times).toEqual([...times].sort((left, right) => right - left));
  expect(times[0]).toBe(Date.parse('2026-03-25T16:30:00Z'));
  expect(times[times.length - 1]).toBe(Date.parse('2026-03-18T09:00:00Z'));

  const first = page.getByTestId('activity-item').first();
  await expect(first.getByTestId('activity-label')).toHaveText('Payment requested');
  await expect(first.getByTestId('activity-status')).toHaveText('PROCESSED');
  await expect(first.getByTestId('activity-version')).toHaveText('v1');
  await expect(first.getByTestId('activity-raw-type')).toHaveText('direct.claim.payment-requested');

  // Activity sits directly after Diary & Notes.
  const tabLabels = (await page.getByRole('tab').allTextContents()).map((label) => label.trim());
  expect(tabLabels.indexOf('Activity')).toBe(tabLabels.indexOf('Diary & Notes') + 1);

  const context = page.getByTestId('activity-context');
  await expect(context).toContainText('derived from the platform event inbox');
  await expect(context).toContainText('remains the source of truth');
  await expect(context).toContainText('Events are append-only');
});

test('requests the claim aggregate path with the tenant header and refreshes card-locally', async ({ page }) => {
  const state = await installMocks(page);
  state.eventsHold = new Promise((resolve) => {
    state.releaseEvents = resolve;
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM_A.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();

  // The held inbox response must not block the claim record.
  await expect(page.getByTestId('activity-loading')).toBeVisible();
  await expect(page.getByTestId('record-subtitle')).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toBeVisible();

  state.releaseEvents();
  state.eventsHold = null;
  await expect(page.getByTestId('activity-item')).toHaveCount(ACTIVITY_EVENTS.length);

  expect(state.eventRequests).toHaveLength(1);
  expect(state.eventRequests[0]).toMatchObject({
    method: 'GET',
    path: `/api/v1/events/aggregate/${CLAIM_A_ID}`,
    limit: '50',
    tenant: TENANT
  });
  expect(state.eventRequests[0].book).toBeUndefined();

  state.events = [...ACTIVITY_EVENTS, EXTRA_EVENT];
  await page.getByTestId('activity-refresh').click();
  await expect(page.getByTestId('activity-item')).toHaveCount(ACTIVITY_EVENTS.length + 1);
  await expect(page.getByTestId('activity-count')).toHaveText(`${ACTIVITY_EVENTS.length + 1} events`);
  expect(state.eventRequests).toHaveLength(2);
});

test('shows a claim-local empty state when the inbox has no events', async ({ page }) => {
  const state = await installMocks(page);
  state.events = [];

  await openActivity(page);

  const empty = page.getByTestId('activity-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No events have been received for this claim yet.');
  await expect(empty).toContainText('remains the source of truth');
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('activity-count')).toHaveText('0 events');
  await expect(page.getByRole('heading', { name: CLAIM_A.claimNumber })).toBeVisible();
});

test('keeps the claim record usable when the inbox returns 503', async ({ page }) => {
  const state = await installMocks(page);
  state.eventsProblem = {
    status: 503,
    detail: 'The event inbox is temporarily unavailable.'
  };

  await openActivity(page);

  const error = page.getByTestId('activity-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('The event inbox is temporarily unavailable.');
  await expect(error).toContainText('The claim record is unaffected.');
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('activity-count')).toHaveText('Activity unavailable');

  // Claim context, summary, and process stepper are untouched by the inbox failure.
  await expect(page.getByRole('heading', { name: CLAIM_A.claimNumber })).toBeVisible();
  await expect(page.getByTestId('record-subtitle')).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toBeVisible();
  await expect(page.getByTestId('claim-progress')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});

test('summarizes the payload facts a claim handler needs', async ({ page }) => {
  await installMocks(page);
  await openActivity(page);

  await expect(itemFor(page, 'Claim updated').getByTestId('activity-fact-status')).toContainText(
    'REGISTERED → OPEN'
  );
  await expect(itemFor(page, 'Reserve changed').getByTestId('activity-fact-reserve')).toContainText(
    'USD 25,000.00'
  );
  await expect(
    itemFor(page, 'Reserve changed').getByTestId('activity-fact-reserveComponent')
  ).toContainText('INDEMNITY');
  await expect(
    itemFor(page, 'Coverage assessed').getByTestId('activity-fact-position')
  ).toContainText('COVERED');
  await expect(
    itemFor(page, 'Settlement authorized').getByTestId('activity-fact-settlement')
  ).toContainText('USD 75,000.00');
  await expect(itemFor(page, 'Diary task created').getByTestId('activity-fact-task')).toContainText(
    'Obtain updated medical records'
  );
  await expect(itemFor(page, 'Note added').getByTestId('activity-fact-note')).toContainText(
    'DIARY · Spoke with the claimant'
  );
  await expect(
    itemFor(page, 'Payment requested').getByTestId('activity-fact-paymentSource')
  ).toContainText('DIRECT_CLAIM · CLM-2026-0000201');
  await expect(itemFor(page, 'Claim registered').getByTestId('activity-fact-reserve')).toContainText(
    'USD 125,000.00'
  );
});

test('refetches when the selected claim changes', async ({ page }) => {
  const state = await installMocks(page);
  state.eventsByAggregate = {
    [CLAIM_A_ID]: [
      makeEvent({
        eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9f11',
        eventType: 'direct.claim.task-created',
        aggregateId: CLAIM_A_ID,
        occurredAt: '2026-04-01T10:00:00Z',
        payload: { taskNumber: 'TSK-A-0001', title: 'Claim A task' }
      })
    ],
    [CLAIM_B_ID]: [
      makeEvent({
        eventId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9f12',
        eventType: 'direct.claim.task-created',
        aggregateId: CLAIM_B_ID,
        occurredAt: '2026-04-02T10:00:00Z',
        payload: { taskNumber: 'TSK-B-0001', title: 'Claim B task' }
      })
    ]
  };

  await page.goto(`/?record=${CLAIM_A_ID}`);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByTestId('activity-fact-task')).toContainText('Claim A task');

  // The app's URL state selects another known claim without changing tabs.
  await page.evaluate((record) => {
    const url = new URL(window.location.href);
    url.searchParams.set('record', record);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, CLAIM_B_ID);

  await expect(page.getByRole('heading', { name: CLAIM_B.claimNumber })).toBeVisible();
  await expect(page.getByTestId('activity-fact-task')).toContainText('Claim B task');
  expect(state.eventRequests.map((request) => request.aggregateId)).toEqual([
    CLAIM_A_ID,
    CLAIM_B_ID
  ]);
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});
