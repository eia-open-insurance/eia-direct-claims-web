import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000001',
  claimType: 'BODILY_INJURY',
  status: 'REGISTERED',
  lossDate: '2026-03-14',
  reportDate: '2026-03-18',
  causeCode: 'GL',
  reserveAmount: '125000.0000',
  currentReserveAmount: '125000.0000',
  reserveCurrency: 'USD',
  version: 0
};

const DOCUMENT_A = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000001',
  title: 'Policy schedule',
  documentType: 'POLICY',
  classification: 'CONFIDENTIAL',
  status: 'ACTIVE',
  retentionUntil: '2036-10-19',
  version: 1
};

const DOCUMENT_B = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000002',
  title: 'Loss run',
  documentType: 'LOSS_ADVICE',
  classification: 'INTERNAL',
  status: 'RECEIVED',
  retentionUntil: '2031-01-31',
  version: 0
};

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the claim queue plus the detail reads the Overview issues, and records
 * every linked-document request so a test can assert the exact query and
 * headers. `gate` holds the document response open to prove the claim renders
 * without it; `status` makes the lookup fail.
 */
async function installMock(page, options = {}) {
  const state = { documentRequests: [] };

  await page.route('**/api/v1/claims', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfill(route, 200, [CLAIM]);
      return;
    }
    await fulfill(route, 200, {});
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    await fulfill(route, 200, []);
  });

  await page.route('**/api/v1/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    state.documentRequests.push({
      method: request.method(),
      path: url.pathname,
      linkedType: url.searchParams.get('linkedType'),
      linkedId: url.searchParams.get('linkedId'),
      tenant: headers['x-eia-tenant'] || null,
      book: headers['x-eia-book'] || null
    });

    if (options.gate) await options.gate;

    if (options.status && options.status !== 200) {
      await fulfill(route, options.status, {
        code: 'EIA-DOC-5030',
        category: 'UNAVAILABLE',
        message: 'Document service is unavailable'
      });
      return;
    }

    await fulfill(route, 200, options.body === undefined ? [DOCUMENT_A, DOCUMENT_B] : options.body);
  });

  return state;
}

test('loads linked documents with the DIRECT_CLAIM query and tenant header', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('documents-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Documents/ })).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('2');
  await expect(page.getByTestId('documents-context')).toContainText('evidence');
  await expect(page.getByTestId('documents-context')).toContainText('source of truth');

  const rows = page.getByTestId('document-row');
  await expect(rows).toHaveCount(2);

  const first = rows.filter({ hasText: DOCUMENT_A.documentNumber });
  await expect(first).toContainText(DOCUMENT_A.title);
  await expect(first).toContainText(DOCUMENT_A.documentType);
  await expect(first).toContainText(DOCUMENT_A.status);
  await expect(first.getByRole('link')).toHaveAttribute('href', `/document?record=${DOCUMENT_A.id}`);

  const second = rows.filter({ hasText: DOCUMENT_B.documentNumber });
  await expect(second).toContainText(DOCUMENT_B.title);
  await expect(second.getByRole('link')).toHaveAttribute('href', `/document?record=${DOCUMENT_B.id}`);

  expect(state.documentRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/documents',
      linkedType: 'DIRECT_CLAIM',
      linkedId: CLAIM_ID,
      tenant: TENANT,
      book: null
    }
  ]);
});

test('accepts the {items} page envelope from the documents API', async ({ page }) => {
  await installMock(page, { body: { items: [DOCUMENT_A], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('documents-count')).toHaveText('1');
  await expect(page.getByTestId('document-row')).toHaveCount(1);
  await expect(page.getByTestId('document-number')).toHaveText(DOCUMENT_A.documentNumber);
  await expect(page.getByTestId('document-row').getByRole('link')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_A.id}`
  );
});

test('shows the empty state when no documents are linked', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('documents-count')).toHaveText('0');
  await expect(page.getByTestId('documents-empty')).toHaveText(
    'No documents linked to this claim yet.'
  );
  await expect(page.getByTestId('document-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
});

test('keeps the claim rendered when the documents lookup fails', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('documents-error')).toContainText(
    'Linked documents could not be loaded'
  );
  await expect(page.getByTestId('document-row')).toHaveCount(0);

  // The claim record and its other sections are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('summary-current-reserve')).toContainText('125,000.00');
});

test('renders the claim before the documents response arrives', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await installMock(page, { gate });

  await page.goto('/');

  await expect(page.getByTestId('documents-loading')).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('—');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();

  release();
  await expect(page.getByTestId('document-row')).toHaveCount(2);
  await expect(page.getByTestId('documents-loading')).toHaveCount(0);
});
