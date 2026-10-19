import React, { useEffect, useState } from 'react';
import { api, BOOK, money } from './api.js';
import CoverageTab from './CoverageTab.jsx';
import InjuryExposureTab from './InjuryExposureTab.jsx';
import LitigationTab from './LitigationTab.jsx';
import RecoveryLienTab from './RecoveryLienTab.jsx';
import ReserveTab from './ReserveTab.jsx';
import SettlementTab from './SettlementTab.jsx';

const EMPTY_FORM = {
  policyId: '',
  claimantPartyId: '',
  lossDate: '',
  reportDate: '',
  causeCode: '',
  claimType: 'BODILY_INJURY',
  reserveAmount: '0.00',
  reserveCurrency: 'USD',
  settlementAuthorityAmount: ''
};

const TABS = [
  { id: 'injuries', label: 'Injuries & exposures' },
  { id: 'reserves', label: 'Reserve history' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'litigation', label: 'Litigation' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'recovery', label: 'Recovery & liens' }
];

function statusColour(status) {
  if (status === 'CLOSED' || status === 'PAID') return '#1b5e20';
  if (status === 'DENIED' || status === 'WITHDRAWN' || status === 'DISMISSED') return '#b00020';
  if (status === 'IN_LITIGATION' || status === 'IN_SETTLEMENT') return '#8a4b00';
  return '#0b3d91';
}

export default function App() {
  const [claims, setClaims] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('injuries');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;

  async function load() {
    setClaims(await api.claims.list());
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
      const payload = {
        policyId: form.policyId,
        claimantPartyId: form.claimantPartyId,
        lossDate: form.lossDate,
        reportDate: form.reportDate,
        causeCode: form.causeCode,
        claimType: form.claimType,
        reserveAmount: Number(form.reserveAmount || 0),
        reserveCurrency: form.reserveCurrency
      };
      if (form.settlementAuthorityAmount !== '') {
        payload.settlementAuthorityAmount = form.settlementAuthorityAmount;
        payload.settlementAuthorityCurrency = form.reserveCurrency;
      }
      await api.claims.create(payload);
      setForm(EMPTY_FORM);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function renderTab() {
    if (!selectedClaim) return null;
    switch (activeTab) {
      case 'reserves':
        return <ReserveTab claim={selectedClaim} onChanged={load} />;
      case 'coverage':
        return <CoverageTab claim={selectedClaim} />;
      case 'litigation':
        return <LitigationTab claim={selectedClaim} />;
      case 'settlements':
        return <SettlementTab claim={selectedClaim} />;
      case 'recovery':
        return <RecoveryLienTab claim={selectedClaim} />;
      default:
        return <InjuryExposureTab claim={selectedClaim} />;
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
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
        FNOL registration and claim workbench for directly underwritten policies: injury and exposure,
        reserve history, coverage, litigation, settlement, recovery, and liens. Requests carry the DIRECT
        book wall; assumed-book records are never visible here.
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

          <label htmlFor="claimType">Claim type</label>
          <select id="claimType" value={form.claimType} onChange={update('claimType')}>
            <option value="BODILY_INJURY">Bodily injury</option>
            <option value="PRODUCT_LIABILITY">Product liability</option>
            <option value="MASS_TORT">Mass tort</option>
            <option value="ENVIRONMENTAL">Environmental</option>
            <option value="PROPERTY_DAMAGE">Property damage</option>
          </select>

          <label htmlFor="reserveAmount">Reserve amount</label>
          <input id="reserveAmount" type="number" min="0" step="0.01" value={form.reserveAmount} onChange={update('reserveAmount')} required />

          <label htmlFor="reserveCurrency">Reserve currency</label>
          <select id="reserveCurrency" value={form.reserveCurrency} onChange={update('reserveCurrency')}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>

          <label htmlFor="settlementAuthorityAmount">Settlement authority</label>
          <input
            id="settlementAuthorityAmount"
            type="number"
            min="0"
            step="0.01"
            value={form.settlementAuthorityAmount}
            onChange={update('settlementAuthorityAmount')}
            placeholder="Optional authority limit"
          />

          <div />
          <button type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register claim'}</button>
        </form>
      </section>

      <section aria-labelledby="claims-heading" style={{ marginBottom: 24 }}>
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
              <th align="left">Workbench</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr
                key={claim.id}
                style={{
                  borderTop: '1px solid #ddd',
                  background: claim.id === selectedId ? '#f3f7ff' : 'transparent'
                }}
              >
                <td>{claim.claimNumber}</td>
                <td style={{ color: statusColour(claim.status), fontWeight: 600 }}>{claim.status}</td>
                <td>{claim.lossDate}</td>
                <td>{claim.reportDate}</td>
                <td align="right">{money(claim.currentReserveAmount ?? claim.reserveAmount, claim.reserveCurrency)}</td>
                <td>{claim.causeCode || '—'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(claim.id);
                      setError('');
                    }}
                  >
                    Open claim
                  </button>
                </td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: '#666' }}>No DIRECT claims registered yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selectedClaim && (
        <section aria-labelledby="workbench-heading">
          <h2 id="workbench-heading" style={{ fontSize: 18 }}>
            Claim workbench
          </h2>
          <p style={{ marginTop: 0, color: '#444' }}>
            Selected claim <strong>{selectedClaim.claimNumber}</strong> · status {selectedClaim.status} · current
            reserve {money(selectedClaim.currentReserveAmount, selectedClaim.reserveCurrency)}
          </p>
          <nav aria-label="Claim sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 14,
                  border: '1px solid #0b3d91',
                  background: activeTab === tab.id ? '#0b3d91' : '#fff',
                  color: activeTab === tab.id ? '#fff' : '#0b3d91'
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {renderTab()}
        </section>
      )}
    </main>
  );
}
