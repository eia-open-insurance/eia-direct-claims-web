import React from 'react';
import { BOOK, money } from './api.js';
import { humanize, shortId, statusTone } from './ui.jsx';

const ACTIONS = [
  ['injuries', 'Record an injury or exposure'],
  ['reserves', 'Post a reserve change'],
  ['coverage', 'Record a coverage decision'],
  ['litigation', 'Open a litigation matter'],
  ['settlements', 'Propose a settlement'],
  ['recovery', 'Record a recovery or lien']
];

export default function OverviewTab({ claim, onNavigate }) {
  const currency = claim.reserveCurrency || 'USD';

  return (
    <>
      <div className="eia-grid eia-grid-2">
        <section className="eia-card" aria-label="Claim facts">
          <h3>Claim facts</h3>
          <dl className="eia-kv">
            <dt>Claim number</dt>
            <dd className="eia-mono">{claim.claimNumber}</dd>
            <dt>Status</dt>
            <dd><span className={`eia-pill ${statusTone(claim.status)}`}>{claim.status}</span></dd>
            <dt>Book</dt>
            <dd><span className="eia-badge direct">{BOOK}</span></dd>
            <dt>Policy</dt>
            <dd className="eia-mono">{claim.policyId || '—'}</dd>
            <dt>Claimant party</dt>
            <dd className="eia-mono">{claim.claimantPartyId || '—'}</dd>
            <dt>Claim type</dt>
            <dd>{humanize(claim.claimType)}</dd>
            <dt>Cause code</dt>
            <dd>{claim.causeCode || '—'}</dd>
            <dt>Loss date</dt>
            <dd>{claim.lossDate || '—'}</dd>
            <dt>Report date</dt>
            <dd>{claim.reportDate || '—'}</dd>
            <dt>Current reserve</dt>
            <dd>{money(claim.currentReserveAmount ?? claim.reserveAmount, currency)}</dd>
            <dt>Settlement authority</dt>
            <dd>
              {claim.settlementAuthorityAmount == null
                ? '—'
                : money(claim.settlementAuthorityAmount, claim.settlementAuthorityCurrency || currency)}
            </dd>
          </dl>
        </section>

        <section className="eia-card" aria-label="Record actions">
          <h3>Record actions</h3>
          <p style={{ marginTop: 0 }}>
            Work the claim from the record sections. Each action posts against claim{' '}
            <span className="eia-mono">{shortId(claim.id)}</span> with the DIRECT book wall.
          </p>
          <div className="eia-actions" style={{ justifyContent: 'flex-start' }}>
            {ACTIONS.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className="eia-btn-secondary"
                onClick={() => onNavigate(tab)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="eia-card" aria-label="Book wall" style={{ marginTop: 14 }}>
        <h3>DIRECT book wall</h3>
        <p style={{ margin: 0 }}>
          This workbench is scoped to the <span className="eia-badge direct">DIRECT</span> book. Every request
          carries <span className="eia-mono">X-EIA-Book: {BOOK}</span> and the tenant header; assumed-book records
          are never loaded or displayed here.
        </p>
      </section>
    </>
  );
}
