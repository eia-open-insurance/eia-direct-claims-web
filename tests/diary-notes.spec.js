import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d61';
const POLICY_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'DIRECT',
  claimNumber: 'CLM-2026-0000201',
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

const OVERDUE_TASK = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d71',
  taskNumber: 'TSK-2026-0001',
  title: 'Chase updated medical records',
  description: 'Provider has not returned the records requested at FNOL.',
  dueDate: '2020-01-05',
  priority: 'URGENT',
  status: 'OPEN',
  assignedTo: 'A. Adjuster',
  version: 3,
  createdAt: '2026-03-18T09:10:00Z',
  updatedAt: '2026-03-20T10:00:00Z',
  completedAt: null
};

const COMPLETED_TASK = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d72',
  taskNumber: 'TSK-2026-0002',
  title: 'Review reserve adequacy',
  description: 'Quarterly reserve review.',
  dueDate: '2099-12-31',
  priority: 'NORMAL',
  status: 'COMPLETE',
  assignedTo: 'B. Examiner',
  version: 1,
  createdAt: '2026-03-18T09:12:00Z',
  updatedAt: '2026-04-01T12:00:00Z',
  completedAt: '2026-04-01T12:00:00Z'
};

const NEWER_NOTE = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d81',
  noteNumber: 'NOT-2026-0002',
  noteType: 'DIARY',
  body: 'Spoke with the claimant about the medical authorization.',
  author: 'Dana Handler',
  createdAt: '2026-04-02T14:30:00Z'
};

const OLDER_NOTE = {
  id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d82',
  noteNumber: 'NOT-2026-0001',
  noteType: 'GENERAL',
  body: 'FNOL received and claim registered on the DIRECT book.',
  author: 'Sam Intake',
  createdAt: '2026-03-18T09:05:00Z'
};

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
    body: JSON.stringify({
      type: 'about:blank',
      title:
        status === 409 ? 'Conflict' : status === 503 ? 'Service Unavailable' : 'Unprocessable Entity',
      status,
      detail
    })
  });
}

/**
 * Mocks the claim queue plus every claim sub-resource the workbench loads.
 * Task and note mutations update the same state so list refreshes are visible.
 */
async function installMocks(page) {
  const state = {
    tasks: [{ ...OVERDUE_TASK }, { ...COMPLETED_TASK }],
    notes: [{ ...NEWER_NOTE }, { ...OLDER_NOTE }],
    requests: [],
    taskCreateBody: null,
    taskPatchBody: null,
    taskPatchPath: null,
    noteCreateBody: null,
    conflict: false,
    taskCreateProblem: false,
    taskCreateKeys: [],
    noteCreateKeys: [],
    taskCreateGate: null,
    taskCreateFailFirst: false
  };

  await page.route('**/api/v1/claims', async (route) => {
    const request = route.request();
    state.requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      book: request.headers()['x-eia-book']
    });
    await fulfillJson(route, [CLAIM]);
  });

  await page.route('**/api/v1/claims/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    state.requests.push({ method, path: url.pathname, book: request.headers()['x-eia-book'] });

    const match = url.pathname.match(/^\/api\/v1\/claims\/[^/]+\/([a-z]+)(?:\/([^/]+))?$/);
    const section = match?.[1];
    const resourceId = match?.[2];

    if (method === 'GET' && section === 'tasks') {
      await fulfillJson(route, state.tasks);
      return;
    }

    if (method === 'POST' && section === 'tasks') {
      state.taskCreateKeys.push(request.headers()['idempotency-key']);
      const attempt = state.taskCreateKeys.length;
      state.taskCreateBody = request.postDataJSON();
      if (state.taskCreateGate) await state.taskCreateGate;
      if (state.taskCreateFailFirst && attempt === 1) {
        await fulfillProblem(route, 503, 'The task service is temporarily unavailable.');
        return;
      }
      if (state.taskCreateProblem) {
        await fulfillProblem(route, 422, 'Task title is not allowed on a closed claim.');
        return;
      }
      const created = {
        id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d73',
        taskNumber: 'TSK-2026-0003',
        title: state.taskCreateBody.title,
        description: state.taskCreateBody.description,
        dueDate: state.taskCreateBody.dueDate,
        priority: state.taskCreateBody.priority,
        status: 'OPEN',
        assignedTo: state.taskCreateBody.assignedTo,
        version: 0,
        createdAt: '2026-10-20T12:00:00Z',
        updatedAt: '2026-10-20T12:00:00Z',
        completedAt: null
      };
      state.tasks = [...state.tasks, created];
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === 'PATCH' && section === 'tasks') {
      state.taskPatchBody = request.postDataJSON();
      state.taskPatchPath = url.pathname;
      if (state.conflict) {
        state.conflict = false;
        await fulfillProblem(
          route,
          409,
          'Task version conflict: the task was changed by another user.'
        );
        return;
      }
      const existing = state.tasks.find((task) => task.id === resourceId);
      const updated = {
        ...existing,
        status: state.taskPatchBody.status,
        version: (existing?.version || 0) + 1,
        updatedAt: '2026-10-20T12:00:00Z',
        completedAt:
          state.taskPatchBody.status === 'COMPLETE' ? '2026-10-20T12:00:00Z' : null
      };
      state.tasks = state.tasks.map((task) => (task.id === resourceId ? updated : task));
      await fulfillJson(route, updated);
      return;
    }

    if (method === 'GET' && section === 'notes') {
      await fulfillJson(route, state.notes);
      return;
    }

    if (method === 'POST' && section === 'notes') {
      state.noteCreateKeys.push(request.headers()['idempotency-key']);
      state.noteCreateBody = request.postDataJSON();
      const created = {
        id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d83',
        noteNumber: 'NOT-2026-0003',
        noteType: state.noteCreateBody.noteType,
        body: state.noteCreateBody.body,
        author: state.noteCreateBody.author,
        createdAt: '2026-10-20T12:05:00Z'
      };
      state.notes = [created, ...state.notes];
      await fulfillJson(route, created, 201);
      return;
    }

    if (method === 'GET' && section === 'coverage') {
      await fulfillProblem(route, 404, 'No coverage decision recorded');
      return;
    }

    if (method === 'GET' && section === 'reserves') {
      await fulfillJson(route, {
        totalCurrentAmount: 0,
        currency: 'USD',
        components: [],
        history: []
      });
      return;
    }

    if (method === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, {});
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

  return state;
}

async function openDiaryTab(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.claimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Diary & Notes', exact: true }).click();
}

test('loads diary tasks and notes and visibly marks overdue tasks', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByRole('heading', { name: 'Diary tasks' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  const overdueRows = page.locator('tr.eia-diary-overdue');
  await expect(overdueRows).toHaveCount(1);
  await expect(overdueRows).toContainText('TSK-2026-0001');
  await expect(overdueRows).toContainText('Overdue');
  await expect(page.getByTestId(`task-overdue-${OVERDUE_TASK.id}`)).toBeVisible();

  // The completed task is not overdue and is not counted as open.
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
  await expect(page.getByTestId('diary-open-count')).toContainText('1 open · 1 overdue');

  await expect(page.getByTestId('note-item')).toHaveCount(2);
  const firstNote = page.getByTestId('note-item').first();
  await expect(firstNote).toContainText('NOT-2026-0002');
  await expect(firstNote).toContainText(NEWER_NOTE.body);
  await expect(firstNote).toContainText('DIARY');
  await expect(firstNote).toContainText('Dana Handler');

  // The existing tabs, stepper, and book wall survive the new workspace.
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByTestId('claim-progress')).toBeVisible();
  await expect(page.getByText('DIRECT book', { exact: true })).toBeVisible();

  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/tasks')).length
  ).toBeGreaterThanOrEqual(2);
  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/notes')).length
  ).toBeGreaterThanOrEqual(1);
  expect(state.requests.every((entry) => entry.book === 'DIRECT')).toBeTruthy();
});

test('adds a diary task with the form payload and refreshes the task list', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Title').fill('Obtain wage loss records');
  await dialog.getByLabel('Description').fill('Request the employer records for the 2026 loss period.');
  await dialog.getByLabel('Due date').fill('2026-12-15');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Assignee').fill('Jordan Claims');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(dialog).toBeHidden();
  expect(state.taskCreateBody).toEqual({
    title: 'Obtain wage loss records',
    description: 'Request the employer records for the 2026 loss period.',
    dueDate: '2026-12-15',
    priority: 'HIGH',
    assignedTo: 'Jordan Claims'
  });

  await expect(page.getByText('TSK-2026-0003', { exact: true })).toBeVisible();
  await expect(page.getByText('Obtain wage loss records', { exact: true })).toBeVisible();
  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/tasks')).length
  ).toBeGreaterThanOrEqual(2);
  expect(
    state.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/tasks'))
  ).toHaveLength(1);
});

test('completes and reopens a task with its current version and refreshes the summary', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
  await page.getByRole('button', { name: 'Complete TSK-2026-0001' }).click();

  await expect(page.getByRole('button', { name: 'Reopen TSK-2026-0001' })).toBeVisible();
  expect(state.taskPatchBody).toEqual({ status: 'COMPLETE', version: 3 });
  expect(state.taskPatchPath).toBe(`/api/v1/claims/${CLAIM_ID}/tasks/${OVERDUE_TASK.id}`);
  expect(
    state.requests.find(
      (entry) =>
        entry.method === 'PATCH' && entry.path === `/api/v1/claims/${CLAIM_ID}/tasks/${OVERDUE_TASK.id}`
    )?.book
  ).toBe('DIRECT');

  await expect(page.getByTestId('summary-open-tasks')).toHaveText('0');
  await expect(page.locator('tr.eia-diary-overdue')).toHaveCount(0);
  const completedRow = page.locator('tr', { hasText: 'TSK-2026-0001' });
  await expect(completedRow).toContainText('COMPLETE');

  await page.getByRole('button', { name: 'Reopen TSK-2026-0001' }).click();
  await expect(page.getByRole('button', { name: 'Complete TSK-2026-0001' })).toBeVisible();
  expect(state.taskPatchBody).toEqual({ status: 'OPEN', version: 4 });
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
});

test('adds a note with the form payload and places it at the top of the timeline', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('note-item').first()).toContainText(NEWER_NOTE.body);

  await page.getByLabel('Note type').selectOption('COVERAGE');
  await page.getByLabel('Author').fill('Dana Handler');
  await page.getByLabel('Note body').fill('Coverage position confirmed with counsel.');
  await page.getByRole('button', { name: 'Add note' }).click();

  expect(state.noteCreateBody).toEqual({
    noteType: 'COVERAGE',
    author: 'Dana Handler',
    body: 'Coverage position confirmed with counsel.'
  });

  await expect(page.getByTestId('note-item')).toHaveCount(3);
  const firstNote = page.getByTestId('note-item').first();
  await expect(firstNote).toContainText('Coverage position confirmed with counsel.');
  await expect(firstNote).toContainText('Dana Handler');
  await expect(firstNote).toContainText('COVERAGE');
  await expect(firstNote).toContainText('NOT-2026-0003');
  await expect(page.getByTestId('note-item').nth(1)).toContainText(NEWER_NOTE.body);
});

test('shows problem+json errors for a 409 task conflict and a rejected task', async ({ page }) => {
  const state = await installMocks(page);
  state.conflict = true;
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Complete TSK-2026-0001' }).click();

  const conflictAlert = page.getByRole('alert');
  await expect(conflictAlert).toContainText(
    'Task version conflict: the task was changed by another user.'
  );
  await expect(conflictAlert).toContainText('reload the diary');
  await expect(page.getByRole('button', { name: 'Complete TSK-2026-0001' })).toBeVisible();
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');

  state.taskCreateProblem = true;
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Confirm lien resolution');
  await dialog.getByLabel('Due date').fill('2026-12-20');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(
    'Task title is not allowed on a closed claim.'
  );
});

test('sends a valid UUID idempotency key when a diary task is created', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill('Obtain wage loss records');
  await dialog.getByLabel('Due date').fill('2026-12-15');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(dialog).toBeHidden();

  expect(state.taskCreateKeys).toHaveLength(1);
  expect(state.taskCreateKeys[0]).toMatch(UUID_PATTERN);
});

test('reuses the task idempotency key when submit is clicked again while the first response is blocked', async ({
  page
}) => {
  const state = await installMocks(page);
  state.taskCreateFailFirst = true;
  let releaseFirstResponse;
  state.taskCreateGate = new Promise((resolve) => {
    releaseFirstResponse = resolve;
  });

  await openDiaryTab(page);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Confirm lien resolution');
  await dialog.getByLabel('Due date').fill('2026-12-20');

  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  // The first POST is still held by the mock; force a second submit from the
  // same form, as a double-click or an eager retry would.
  await dialog.locator('form').evaluate((form) => form.requestSubmit());
  await expect.poll(() => state.taskCreateKeys.length).toBe(2);

  releaseFirstResponse();
  await expect(dialog).toBeHidden();

  expect(state.taskCreateKeys[0]).toMatch(UUID_PATTERN);
  expect(state.taskCreateKeys[1]).toBe(state.taskCreateKeys[0]);
});

test('uses a new idempotency key for the next task after a successful create', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  async function addTask(title, dueDate) {
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Due date').fill(dueDate);
    await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await addTask('First diary task', '2026-12-15');
  await addTask('Second diary task', '2026-12-16');

  expect(state.taskCreateKeys).toHaveLength(2);
  expect(state.taskCreateKeys[0]).toMatch(UUID_PATTERN);
  expect(state.taskCreateKeys[1]).toMatch(UUID_PATTERN);
  expect(state.taskCreateKeys[1]).not.toBe(state.taskCreateKeys[0]);
});

test('sends a separate idempotency key when a note is created', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Confirm coverage position');
  await dialog.getByLabel('Due date').fill('2026-12-18');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel('Author').fill('Dana Handler');
  await page.getByLabel('Note body').fill('Coverage position confirmed with counsel.');
  await page.getByRole('button', { name: 'Add note' }).click();

  await expect(page.getByTestId('note-item')).toHaveCount(3);
  expect(state.noteCreateKeys).toHaveLength(1);
  expect(state.noteCreateKeys[0]).toMatch(UUID_PATTERN);
  expect(state.noteCreateKeys[0]).not.toBe(state.taskCreateKeys[0]);
});

