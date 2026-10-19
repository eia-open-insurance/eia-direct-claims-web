import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'DIRECT';

const EMPTY_FORM = {
  policyId: '',
  claimantPartyId: '',
  lossDate: '',
  reportDate: '',
  causeCode: '',
  reserveAmount: '0.00',
  reserveCurrency: 'USD'
};

function headers(extra = {}) {
  return {
    'X-EIA-Tenant': TENANT,
    'X-EIA-Book': BOOK,
    ...extra
  };
}

function money(claim) {
  const amount = Number(claim.reserveAmount ?? 0);
  return `${claim.reserveCurrency || 'USD'} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function statusColour(status) {
  if (status === 'CLOSED' || status === 'PAID') return '#1b5e20';
  if (status === 'DENIED' || status === 'WITHDRAWN' || status === 'DISMISSED') return '#b00020';
  if (status === 'IN_LITIGATION' || status === 'IN_SETTLEMENT') return '#8a4b00';
  return '#0b3d91';
}

export default function App() {
  const [claims, setClaims] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/v1/claims', { headers: headers() });
    if (!response.ok) {
      throw new Error(`Load failed: ${response.status}`);
    }
    setClaims(await response.json());
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, []);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/claims', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...form,
          reserveAmount: Number(form.reserveAmount || 0)
        })
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(problem.message || `Create failed: ${response.status}`);
      }
      setForm(EMPTY_FORM);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 4 }}>Direct Claims</h1>
        <span
          aria-label="Book scope"
          style={{ background: '#e8f0fe', color: '#0b3d91', padding: '4px 10px', borderRadius: 12, fontSize: 13 }}
        >
          Book: {BOOK}
        </span>
      </header>
      <p style={{ color: '#444', marginTop: 0 }}>
        FNOL registration for directly underwritten policies. Requests carry the DIRECT book wall;
        assumed-book records are never visible here.
      </p>

      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}

      <section aria-labelledby="register-heading" style={{ marginBottom: 28 }}>
        <h2 id="register-heading" style={{ fontSize: 18 }}>Register a claim</h2>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label htmlFor="policyId">Policy ID</label>
          <input id="policyId" value={form.policyId} onChange={update('policyId')} placeholder="Policy UUID" required />

          <label htmlFor="claimantPartyId">Claimant party ID</label>
          <input id="claimantPartyId" value={form.claimantPartyId} onChange={update('claimantPartyId')} placeholder="Party UUID" required />

          <label htmlFor="lossDate">Loss date</label>
          <input id="lossDate" type="date" value={form.lossDate} onChange={update('lossDate')} required />

          <label htmlFor="reportDate">Report date</label>
          <input id="reportDate" type="date" value={form.reportDate} onChange={update('reportDate')} required />

          <label htmlFor="causeCode">Cause code</label>
          <input id="causeCode" value={form.causeCode} onChange={update('causeCode')} maxLength={24} placeholder="ACORD / ISO cause" />

          <label htmlFor="reserveAmount">Reserve amount</label>
          <input id="reserveAmount" type="number" min="0" step="0.01" value={form.reserveAmount} onChange={update('reserveAmount')} required />

          <label htmlFor="reserveCurrency">Reserve currency</label>
          <select id="reserveCurrency" value={form.reserveCurrency} onChange={update('reserveCurrency')}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>

          <div />
          <button type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register claim'}</button>
        </form>
      </section>

      <section aria-labelledby="claims-heading">
        <h2 id="claims-heading" style={{ fontSize: 18 }}>Claims</h2>
        <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Claim</th>
              <th align="left">Status</th>
              <th align="left">Loss date</th>
              <th align="left">Report date</th>
              <th align="right">Reserve</th>
              <th align="left">Cause</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id} style={{ borderTop: '1px solid #ddd' }}>
                <td>{claim.claimNumber}</td>
                <td style={{ color: statusColour(claim.status), fontWeight: 600 }}>{claim.status}</td>
                <td>{claim.lossDate}</td>
                <td>{claim.reportDate}</td>
                <td align="right">{money(claim)}</td>
                <td>{claim.causeCode || '—'}</td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: '#666' }}>No DIRECT claims registered yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
