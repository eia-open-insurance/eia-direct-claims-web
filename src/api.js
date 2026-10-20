export const TENANT = '11111111-1111-7111-8111-111111111111';
export const BOOK = 'DIRECT';
export const REVIEWER_ID = '44444444-4444-7444-8444-444444444444';
export const RELEASE_DOCUMENT_ID = '55555555-5555-7555-8555-555555555555';

export function headers(extra = {}) {
  return {
    'X-EIA-Tenant': TENANT,
    'X-EIA-Book': BOOK,
    ...extra
  };
}

async function request(path, options = {}) {
  // `book` and `tenant` are transport concerns, not fetch options. The default
  // keeps the DIRECT book wall and tenant scope on every domain request; pass
  // `book: null` for shared master data (for example parties), and `tenant: null`
  // for platform-wide master data (for example the people/team directory).
  const { book = BOOK, tenant = TENANT, ...init } = options;
  const response = await fetch(path, {
    ...init,
    cache: init.cache || 'no-store',
    headers: {
      ...(tenant ? { 'X-EIA-Tenant': tenant } : {}),
      ...(book ? { 'X-EIA-Book': book } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const error = new Error(problem.message || problem.detail || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

/**
 * Stable key for one logical create attempt. `crypto.randomUUID` is available
 * in every supported browser; the fallback keeps the v4 shape for older
 * webviews so the server always receives a valid UUID.
 */
export function newIdempotencyKey() {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function idempotencyHeaders(key) {
  return key ? { 'Idempotency-Key': key } : {};
}

/** Create a diary task; `key` is optional for callers that do not retry. */
export function createTask(claimId, body, key) {
  return request(`/api/v1/claims/${claimId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idempotencyHeaders(key)
  });
}

/** Create a claim note; `key` is optional for callers that do not retry. */
export function createNote(claimId, body, key) {
  return request(`/api/v1/claims/${claimId}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idempotencyHeaders(key)
  });
}

export const api = {
  directory: {
    /**
     * People and teams for assignment. The directory is platform master data,
     * not book- or tenant-scoped, so neither wall is sent on this read.
     */
    get: () => request('/api/v1/directory', { book: null, tenant: null })
  },
  claims: {
    list: () => request('/api/v1/claims'),
    get: (claimId) => request(`/api/v1/claims/${claimId}`),
    search: (query, limit = 10) =>
      request(`/api/v1/claims/search?q=${encodeURIComponent(query || '')}&limit=${limit}`),
    create: (body) => request('/api/v1/claims', { method: 'POST', body: JSON.stringify(body) }),
    close: (claimId, body = {}) =>
      request(`/api/v1/claims/${claimId}/close`, { method: 'POST', body: JSON.stringify(body) }),
    /**
     * Change operational ownership only. `expectedVersion` is the claim
     * version the caller read; a stale version is rejected with 409.
     */
    assign: (claimId, body, actor) =>
      request(`/api/v1/claims/${claimId}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: actor ? { 'X-EIA-Actor': actor } : {}
      })
  },
  policies: {
    /** Policy detail is book-owned, so the DIRECT wall applies. */
    get: (policyId) => request(`/api/v1/policies/${encodeURIComponent(policyId)}`)
  },
  parties: {
    /** Party master data is shared across books and is scoped by tenant only. */
    get: (partyId) =>
      request(`/api/v1/parties/${encodeURIComponent(partyId)}`, { book: null })
  },
  cessions: {
    search: (query, limit = 5) =>
      request(`/api/v1/cessions/search?q=${encodeURIComponent(query || '')}&limit=${limit}`)
  },
  documents: {
    /**
     * Documents linked to one claim. The link type identifies the claim book;
     * the claim id is the business record the document association points at.
     * The document service scopes by tenant, so the DIRECT book wall is not
     * required for this lookup.
     */
    listLinked: (linkedType, linkedId) =>
      request(
        `/api/v1/documents?linkedType=${encodeURIComponent(linkedType)}&linkedId=${encodeURIComponent(
          linkedId
        )}`,
        { book: null }
      )
  },
  injuries: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/injuries`),
    create: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/injuries`, { method: 'POST', body: JSON.stringify(body) }),
    update: (claimId, injuryId, body) =>
      request(`/api/v1/claims/${claimId}/injuries/${injuryId}`, { method: 'PATCH', body: JSON.stringify(body) })
  },
  exposures: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/exposures`),
    create: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/exposures`, { method: 'POST', body: JSON.stringify(body) })
  },
  reserves: {
    get: (claimId) => request(`/api/v1/claims/${claimId}/reserves`),
    change: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/reserves`, { method: 'POST', body: JSON.stringify(body) })
  },
  coverage: {
    get: (claimId) => request(`/api/v1/claims/${claimId}/coverage`),
    decide: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/coverage`, { method: 'POST', body: JSON.stringify(body) })
  },
  litigation: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/litigation`),
    create: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/litigation`, { method: 'POST', body: JSON.stringify(body) }),
    update: (claimId, litigationId, body) =>
      request(`/api/v1/claims/${claimId}/litigation/${litigationId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  settlements: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/settlements`),
    propose: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/settlements`, { method: 'POST', body: JSON.stringify(body) }),
    approve: (claimId, settlementId, body) =>
      request(`/api/v1/claims/${claimId}/settlements/${settlementId}/approve`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    execute: (claimId, settlementId, body) =>
      request(`/api/v1/claims/${claimId}/settlements/${settlementId}/execute`, {
        method: 'POST',
        body: JSON.stringify(body)
      })
  },
  payments: {
    // Payment is the financial system of record and owns approval/execution.
    // The claim id is the search term: payments saved from this claim's
    // hand-off carry sourceId=claimId, so the same query returns them.
    search: (query, limit = 5) =>
      request(`/api/v1/payments/search?q=${encodeURIComponent(query || '')}&limit=${limit}`),
    /**
     * Payments linked to one business source. Payment reads are tenant-scoped
     * but operational, so the app's payment calls keep the DIRECT book wall
     * (the same headers its search and detail reads send).
     */
    listBySource: (sourceType, sourceId) =>
      request(
        `/api/v1/payments?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(
          sourceId
        )}`
      ),
    get: (paymentId) => request(`/api/v1/payments/${paymentId}`)
  },
  recoveries: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/recoveries`),
    create: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/recoveries`, { method: 'POST', body: JSON.stringify(body) }),
    update: (claimId, recoveryId, body) =>
      request(`/api/v1/claims/${claimId}/recoveries/${recoveryId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  liens: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/liens`),
    create: (claimId, body) =>
      request(`/api/v1/claims/${claimId}/liens`, { method: 'POST', body: JSON.stringify(body) }),
    update: (claimId, lienId, body) =>
      request(`/api/v1/claims/${claimId}/liens/${lienId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  tasks: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/tasks`),
    create: (claimId, body, key) => createTask(claimId, body, key),
    update: (claimId, taskId, body) =>
      request(`/api/v1/claims/${claimId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  notes: {
    list: (claimId) => request(`/api/v1/claims/${claimId}/notes`),
    create: (claimId, body, key) => createNote(claimId, body, key)
  },
  events: {
    /**
     * Activity events for one claim aggregate, newest first as published by the
     * platform event inbox. The inbox is tenant-scoped, not book-scoped, so the
     * DIRECT wall is not sent on this platform read.
     */
    aggregate: (claimId, limit = 50) =>
      request(`/api/v1/events/aggregate/${encodeURIComponent(claimId)}?limit=${limit}`, {
        book: null
      })
  }
};

export function money(amount, currency = 'USD') {
  const value = Number(amount ?? 0);
  return `${currency} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
