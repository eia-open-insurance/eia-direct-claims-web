import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d61';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000401',
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

function notification(overrides = {}) {
  return {
    tenantId: TENANT,
    notificationType: 'CLAIM_STATUS_CHANGE',
    channel: 'EMAIL',
    status: 'SENT',
    sourceType: 'DIRECT_CLAIM',
    sourceId: CLAIM_ID,
    sourceReference: CLAIM.claimNumber,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-01T12:00:00Z',
    ...overrides
  };
}

// Deliberately out of order and mixed with rows that point at another claim or
// another source: the card must show only this claim's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d91',
  notificationNumber: 'NTF-2026-0000041',
  subject: 'Claim moved to settlement',
  status: 'DELIVERED',
  createdAt: '2026-04-12T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d90',
  notificationNumber: 'NTF-2026-0000040',
  subject: 'Settlement approval recorded',
  status: 'READ',
  createdAt: '2026-04-02T10:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d89',
  notificationNumber: 'NTF-2026-0000039',
  subject: 'Reserve change acknowledged',
  status: 'QUEUED',
  createdAt: '2026-03-28T14:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d88',
  notificationNumber: 'NTF-2026-0000038',
  subject: 'Claim registered',
  status: 'FAILED',
  createdAt: '2026-03-01T08:00:00Z'
});

const NOTIFICATION_OTHER_CLAIM = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d87',
  notificationNumber: 'NTF-2026-0000037',
  subject: 'Other claim reminder',
  status: 'SENT',
  sourceId: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d62',
  createdAt: '2026-04-20T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d86',
  notificationNumber: 'NTF-2026-0000036',
  subject: 'Payment receipt',
  status: 'SENT',
  sourceType: 'PAYMENT',
  createdAt: '2026-04-21T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_CLAIM,
  NOTIFICATION_OTHER_SOURCE
];

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the claim queue plus the Overview's other card reads, and records every
 * related-notifications request so a test can assert the exact source query and
 * headers. `status` makes the lookup fail; `body` replaces the default payload.
 */
async function installMock(page, options = {}) {
  const state = { notificationRequests: [] };

  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, [CLAIM]);
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
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/notifications**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    state.notificationRequests.push({
      method: request.method(),
      path: url.pathname,
      sourceType: url.searchParams.get('sourceType'),
      sourceId: url.searchParams.get('sourceId'),
      tenant: headers['x-eia-tenant'] || null,
      book: headers['x-eia-book'] || null
    });

    if (options.gate) await options.gate;

    if (options.status && options.status !== 200) {
      await fulfillJson(
        route,
        {
          code: 'EIA-NTF-5030',
          category: 'UNAVAILABLE',
          message: 'Notification service is unavailable'
        },
        options.status
      );
      return;
    }

    await fulfillJson(route, options.body === undefined ? RELATED : options.body);
  });

  return state;
}

test('lists the newest three related notifications with count and source query', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('notifications-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Related notifications/ })).toBeVisible();
  await expect(page.getByTestId('notifications-count')).toHaveText('4');
  await expect(page.getByTestId('notifications-context')).toContainText(
    'Notifications owns delivery, escalation, and acknowledgement'
  );

  const rows = page.getByTestId('notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first, and the oldest linked row plus the unrelated rows stay hidden.
  await expect(rows.nth(0).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_NEWEST.notificationNumber
  );
  await expect(rows.nth(1).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_MIDDLE.notificationNumber
  );
  await expect(rows.nth(2).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(rows.filter({ hasText: NOTIFICATION_OLDEST.notificationNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: NOTIFICATION_OTHER_CLAIM.notificationNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: NOTIFICATION_OTHER_SOURCE.notificationNumber })).toHaveCount(0);

  const newest = rows.filter({ hasText: NOTIFICATION_NEWEST.notificationNumber });
  await expect(newest.getByTestId('notification-subject')).toHaveText(
    NOTIFICATION_NEWEST.subject
  );
  await expect(newest.getByTestId('notification-status')).toContainText('DELIVERED');
  await expect(newest.getByTestId('notification-created')).toHaveText('2026-04-12');
  await expect(newest.getByRole('link')).toHaveAttribute(
    'href',
    `/notifications?record=${NOTIFICATION_NEWEST.id}`
  );

  await expect(page.getByTestId('notifications-more')).toHaveText(
    'Showing the 3 newest of 4 linked notifications.'
  );
  await expect(page.getByTestId('notifications-view-all')).toHaveAttribute(
    'href',
    `/search?q=${encodeURIComponent(CLAIM.claimNumber)}`
  );
  await expect(page.getByTestId('notifications-view-all-row')).toContainText(
    'the Notifications queue has no source filter'
  );

  expect(state.notificationRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/notifications',
      sourceType: 'DIRECT_CLAIM',
      sourceId: CLAIM_ID,
      tenant: TENANT,
      book: null
    }
  ]);
});

test('accepts the {items} page envelope and renders a single notification', async ({ page }) => {
  await installMock(page, { body: { items: [NOTIFICATION_OLD], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  await expect(page.getByTestId('notification-row')).toHaveCount(1);
  await expect(page.getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(page.getByTestId('notification-created')).toHaveText('2026-03-28');
  await expect(page.getByTestId('notifications-more')).toHaveCount(0);
});

test('shows the empty state when no notification is linked to the claim', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('notifications-count')).toHaveText('0');
  await expect(page.getByTestId('notifications-empty')).toHaveText(
    'No notifications linked to this claim.'
  );
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
});

test('contains a notifications failure inside the card', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('notifications-error')).toContainText(
    'Related notifications could not be loaded'
  );
  await expect(page.getByTestId('notifications-error')).toContainText(
    'claim record is unaffected'
  );
  await expect(page.getByTestId('notifications-count')).toHaveText('—');
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();

  // The claim record and its other Overview cards are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toContainText('125,000.00');
  await expect(page.getByTestId('documents-card')).toBeVisible();
  await expect(page.getByTestId('payments-card')).toBeVisible();
});

test('links each notification to its record and opens claim search for all', async ({ page }) => {
  await installMock(page);

  await page.goto('/');

  await page.getByTestId(`notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto('/');
  await page.getByTestId('notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/search\\?q=${encodeURIComponent(CLAIM.claimNumber)}$`)
  );
});
