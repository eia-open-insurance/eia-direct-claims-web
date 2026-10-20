import React, { useEffect, useState } from 'react';
import './ui.css';
import { api, BOOK, money } from './api.js';
import CoverageTab from './CoverageTab.jsx';
import InjuryExposureTab from './InjuryExposureTab.jsx';
import LitigationTab from './LitigationTab.jsx';
import OverviewTab from './OverviewTab.jsx';
import RecoveryLienTab from './RecoveryLienTab.jsx';
import ReserveTab from './ReserveTab.jsx';
import SettlementTab from './SettlementTab.jsx';
import { ErrorText, Field, humanize, shortId, statusTone } from './ui.jsx';

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
  { id: 'overview', label: 'Overview' },
  { id: 'injuries', label: 'Injuries & Exposures' },
  { id: 'reserves', label: 'Reserve History' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'litigation', label: 'Litigation' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'recovery', label: 'Recovery & Liens' }
];

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(880px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function sumBy(rows, statuses) {
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((row) => statuses.includes(row.status))
    .reduce((total, row) => total + (Number(row.amount) || 0), 0);
}

export default function App() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [summary, setSummary] = useState({ paidLoss: null, recoveries: null });
  const [summaryNonce, setSummaryNonce] = useState(0);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;
  const selectedClaimId = selectedClaim?.id || null;
  const currency = selectedClaim?.reserveCurrency || 'USD';

  async function load() {
    const rows = await api.claims.list();
    setClaims(Array.isArray(rows) ? rows : []);
    return Array.isArray(rows) ? rows : [];
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && claims.some((claim) => claim.id === current)) return current;
      return claims[0]?.id || null;
    });
  }, [claims]);

  useEffect(() => {
    let alive = true;
    if (!selectedClaimId) {
      setSummary({ paidLoss: null, recoveries: null });
      return undefined;
    }

    setSummary({ paidLoss: null, recoveries: null });
    Promise.allSettled([
      api.settlements.list(selectedClaimId),
      api.recoveries.list(selectedClaimId)
    ]).then(([settlementsResult, recoveriesResult]) => {
      if (!alive) return;
      const settlements = settlementsResult.status === 'fulfilled' ? settlementsResult.value : null;
      const recoveries = recoveriesResult.status === 'fulfilled' ? recoveriesResult.value : null;
      setSummary({
        paidLoss: sumBy(settlements, ['EXECUTED', 'PAID']),
        recoveries: sumBy(recoveries, ['RECEIVED'])
      });
    });

    return () => {
      alive = false;
    };
  }, [selectedClaimId, summaryNonce]);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !registerBusy) {
        setRegisterOpen(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registerOpen, registerBusy]);

  function refreshSummary() {
    setSummaryNonce((value) => value + 1);
  }

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function refresh() {
    setError('');
    try {
      await load();
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function handleRecordChanged() {
    refreshSummary();
    try {
      await load();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function selectClaim(claim) {
    if (claim.id !== selectedId) setActiveTab('overview');
    setSelectedId(claim.id);
    setError('');
    setNotice('');
  }

  function openRegister() {
    setForm(EMPTY_FORM);
    setError('');
    setRegisterOpen(true);
  }

  function closeRegister() {
    if (registerBusy) return;
    setRegisterOpen(false);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setRegisterBusy(true);
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
      const created = await api.claims.create(payload);
      setForm(EMPTY_FORM);
      setRegisterOpen(false);
      await load();
      if (created?.id) setSelectedId(created.id);
      setActiveTab('overview');
      setNotice(
        created?.claimNumber
          ? `Claim ${created.claimNumber} registered on the DIRECT book.`
          : 'Claim registered on the DIRECT book.'
      );
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setRegisterBusy(false);
    }
  }

  async function closeClaim() {
    if (!selectedClaim || selectedClaim.status === 'CLOSED') return;
    const confirmed = window.confirm(
      `Close ${selectedClaim.claimNumber}?\n\nClosure zeroes current reserves and requires no open reserves, outstanding payments, unresolved liens, or open payment-follow-up diary items.`
    );
    if (!confirmed) return;

    setClosing(true);
    setError('');
    try {
      const closed = await api.claims.close(selectedClaim.id, { expectedVersion: selectedClaim.version });
      await load();
      setSelectedId(closed?.id || selectedClaim.id);
      setNotice(`${closed?.claimNumber || selectedClaim.claimNumber} closed.`);
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setClosing(false);
    }
  }

  function renderTab() {
    if (!selectedClaim) return null;
    switch (activeTab) {
      case 'overview':
        return <OverviewTab claim={selectedClaim} onNavigate={setActiveTab} />;
      case 'reserves':
        return <ReserveTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'coverage':
        return <CoverageTab claim={selectedClaim} />;
      case 'litigation':
        return <LitigationTab claim={selectedClaim} />;
      case 'settlements':
        return <SettlementTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'recovery':
        return <RecoveryLienTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      default:
        return <InjuryExposureTab claim={selectedClaim} />;
    }
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Claims · Direct book</div>
          <h1>Direct claims</h1>
          <p className="subtitle">
            FNOL registration and the operational claim record for directly underwritten policies: injuries and
            exposures, reserve history, coverage, litigation, settlements, recovery, and liens.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct" aria-label="Book scope">DIRECT book</span>
          <button type="button" className="eia-btn-ghost" onClick={refresh}>Refresh</button>
          <button type="button" onClick={openRegister} aria-haspopup="dialog">Register claim</button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !registerOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Direct claim queue">
          <div className="eia-record-list-head">
            <strong>Claim queue</strong>
            <span className="eia-muted">{loading ? '…' : claims.length}</span>
          </div>
          {claims.map((claim) => (
            <button
              key={claim.id}
              type="button"
              className={claim.id === selectedId ? 'selected' : ''}
              aria-current={claim.id === selectedId ? 'true' : undefined}
              onClick={() => selectClaim(claim)}
            >
              <span className="record-primary">{claim.claimNumber}</span>
              <span className="record-secondary">Claimant {shortId(claim.claimantPartyId)}</span>
              <span className="record-secondary" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`eia-pill ${statusTone(claim.status)}`}>{claim.status}</span>
                <span>Loss {claim.lossDate || '—'}</span>
              </span>
            </button>
          ))}
          {!loading && claims.length === 0 && (
            <div className="empty">No DIRECT claims registered yet.</div>
          )}
          {loading && <div className="empty">Loading DIRECT claims…</div>}
        </aside>

        <section className="eia-record-panel" aria-label="Claim record">
          {selectedClaim ? (
            <>
              <div className="eia-record-title">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 className="eia-mono">{selectedClaim.claimNumber}</h2>
                    <span className={`eia-pill ${statusTone(selectedClaim.status)}`}>{selectedClaim.status}</span>
                  </div>
                  <p className="eia-record-subtitle">
                    Loss date {selectedClaim.lossDate || '—'} · Reported {selectedClaim.reportDate || '—'} ·{' '}
                    {humanize(selectedClaim.claimType)}
                  </p>
                </div>
                <div className="eia-actions">
                  <button type="button" className="eia-btn-ghost" onClick={refresh}>
                    Refresh record
                  </button>
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    onClick={closeClaim}
                    disabled={closing || selectedClaim.status === 'CLOSED'}
                  >
                    {selectedClaim.status === 'CLOSED' ? 'Closed' : closing ? 'Closing…' : 'Close claim'}
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Current reserve</h3>
                  <div className="value" data-testid="summary-current-reserve">
                    {money(selectedClaim.currentReserveAmount ?? selectedClaim.reserveAmount, currency)}
                  </div>
                  <div className="eia-metric-label">Component reserve, latest ledger</div>
                </div>
                <div className="eia-card">
                  <h3>Paid loss</h3>
                  <div className="value" data-testid="summary-paid-loss">
                    {summary.paidLoss == null ? '—' : money(summary.paidLoss, currency)}
                  </div>
                  <div className="eia-metric-label">Executed settlement payments</div>
                </div>
                <div className="eia-card">
                  <h3>Recoveries</h3>
                  <div className="value" data-testid="summary-recoveries">
                    {summary.recoveries == null ? '—' : money(summary.recoveries, currency)}
                  </div>
                  <div className="eia-metric-label">Received third-party recoveries</div>
                </div>
                <div className="eia-card">
                  <h3>Settlement authority</h3>
                  <div className="value" data-testid="summary-settlement-authority">
                    {selectedClaim.settlementAuthorityAmount == null
                      ? '—'
                      : money(
                          selectedClaim.settlementAuthorityAmount,
                          selectedClaim.settlementAuthorityCurrency || currency
                        )}
                  </div>
                  <div className="eia-metric-label">Authorized limit before escalation</div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Claim sections">
                {TABS.map((tab) => (
                  <a
                    key={tab.id}
                    id={`claim-tab-${tab.id}`}
                    href="#claim-tabpanel"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls="claim-tabpanel"
                    className={`eia-tab ${activeTab === tab.id ? 'active' : ''}`}
                    style={{ textDecoration: 'none' }}
                    onClick={(event) => {
                      event.preventDefault();
                      setActiveTab(tab.id);
                    }}
                  >
                    {tab.label}
                  </a>
                ))}
              </nav>
              <div
                id="claim-tabpanel"
                role="tabpanel"
                aria-labelledby={`claim-tab-${activeTab}`}
              >
                {renderTab()}
              </div>
            </>
          ) : (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the DIRECT claim queue…'
                  : 'Select a claim from the queue or register the first DIRECT claim.'}
              </p>
              {!loading && (
                <button type="button" onClick={openRegister} aria-haspopup="dialog">Register claim</button>
              )}
            </div>
          )}
        </section>
      </div>

      {registerOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !registerBusy) closeRegister();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="register-title" style={{ margin: 0 }}>Register claim</h2>
                <p className="eia-record-subtitle">
                  FNOL registration for a directly underwritten policy. The request is walled to the DIRECT book.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeRegister} disabled={registerBusy}>
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <Field label="Policy ID">
                <input
                  id="policyId"
                  value={form.policyId}
                  onChange={update('policyId')}
                  placeholder="Policy UUID"
                  required
                  autoFocus
                />
              </Field>
              <Field label="Claimant party ID">
                <input
                  id="claimantPartyId"
                  value={form.claimantPartyId}
                  onChange={update('claimantPartyId')}
                  placeholder="Party UUID"
                  required
                />
              </Field>
              <Field label="Loss date">
                <input id="lossDate" type="date" value={form.lossDate} onChange={update('lossDate')} required />
              </Field>
              <Field label="Report date">
                <input id="reportDate" type="date" value={form.reportDate} onChange={update('reportDate')} required />
              </Field>
              <Field label="Cause code">
                <input
                  id="causeCode"
                  value={form.causeCode}
                  onChange={update('causeCode')}
                  maxLength={24}
                  placeholder="ACORD / ISO cause"
                />
              </Field>
              <Field label="Claim type">
                <select id="claimType" value={form.claimType} onChange={update('claimType')}>
                  <option value="BODILY_INJURY">Bodily injury</option>
                  <option value="PRODUCT_LIABILITY">Product liability</option>
                  <option value="MASS_TORT">Mass tort</option>
                  <option value="ENVIRONMENTAL">Environmental</option>
                  <option value="PROPERTY_DAMAGE">Property damage</option>
                </select>
              </Field>
              <Field label="Reserve amount">
                <input
                  id="reserveAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.reserveAmount}
                  onChange={update('reserveAmount')}
                  required
                />
              </Field>
              <Field label="Reserve currency">
                <select id="reserveCurrency" value={form.reserveCurrency} onChange={update('reserveCurrency')}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </Field>
              <Field label="Settlement authority">
                <input
                  id="settlementAuthorityAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.settlementAuthorityAmount}
                  onChange={update('settlementAuthorityAmount')}
                  placeholder="Optional authority limit"
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="eia-btn-secondary" onClick={closeRegister} disabled={registerBusy}>
                  Cancel
                </button>
                <button type="submit" disabled={registerBusy}>
                  {registerBusy ? 'Registering…' : 'Register claim'}
                </button>
              </div>
            </form>
            <ErrorText>{error}</ErrorText>
          </section>
        </div>
      )}
    </main>
  );
}
