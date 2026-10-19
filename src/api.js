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
  const response = await fetch(path, {
    ...options,
    headers: headers(options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers)
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

export const api = {
  claims: {
    list: () => request('/api/v1/claims'),
    create: (body) => request('/api/v1/claims', { method: 'POST', body: JSON.stringify(body) })
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
