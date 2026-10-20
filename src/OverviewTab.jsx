import React, { useEffect, useState } from 'react';
import { api, BOOK, money } from './api.js';
import { assignmentText } from './ClaimAssignment.jsx';
import DocumentsCard from './DocumentsCard.jsx';
import { navigate, recordHref } from './navigation.js';
import PaymentsCard from './PaymentsCard.jsx';
import { RelatedLabel } from './related.jsx';
import { humanize, shortId, statusTone } from './ui.jsx';

const ACTIONS = [
  ['injuries', 'Record an injury or exposure'],
  ['reserves', 'Post a reserve change'],
  ['coverage', 'Record a coverage decision'],
  ['allocations', 'Allocate the claim to policy years'],
  ['litigation', 'Open a litigation matter'],
  ['settlements', 'Propose a settlement'],
  ['recovery', 'Record a recovery or lien']
];

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function RelatedRecords({ claim, policy }) {
  const [cessions, setCessions] = useState([]);
  const [state, setState] = useState(claim.policyId ? 'loading' : 'empty');
  const policyHref = claim.policyId ? recordHref('policy', claim.policyId) : '';

  useEffect(() => {
    if (!claim.policyId) {
      setCessions([]);
      setState('empty');
      return undefined;
    }
    let alive = true;
    setState('loading');
    api.cessions
      .search(claim.policyId, 5)
      .then((body) => {
        if (!alive) return;
        const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
        setCessions(items);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setCessions([]);
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [claim.policyId]);

  return (
    <section className="eia-card" aria-label="Related records" style={{ marginTop: 14 }}>
      <h3>Related records</h3>
      <p style={{ margin: '0 0 4px' }}>
        Records generated from the policy behind this claim. Cessions are looked up by policy id on the DIRECT
        book.
      </p>
      <div className="eia-related-list" data-testid="related-records">
        {claim.policyId && (
          <a
            className="eia-related-record"
            href={policyHref}
            onClick={openRecord}
            data-testid="related-policy-link"
            title="Open policy record"
          >
            <b>POLICY</b>
            <span>
              <RelatedLabel related={policy} />
            </span>
          </a>
        )}
        {cessions.map((cession) => {
          const href = cession.href || recordHref('cession', cession.id);
          return (
            <a
              key={cession.id || href}
              className="eia-related-record"
              href={href}
              onClick={openRecord}
              data-testid="related-cession-link"
            >
              <b>{cession.label}</b>
              <span>{cession.secondary}</span>
            </a>
          );
        })}
      </div>
      {state === 'loading' && <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading related cessions…</p>}
      {state === 'empty' && (
        <p className="eia-muted" style={{ margin: '8px 0 0' }}>Policy context is not available for this claim.</p>
      )}
      {state === 'ready' && cessions.length === 0 && (
        <p className="eia-muted" style={{ margin: '8px 0 0' }}>No cessions recorded for this policy.</p>
      )}
      {state === 'error' && (
        <p className="eia-muted" style={{ margin: '8px 0 0' }}>Related cessions could not be loaded.</p>
      )}
    </section>
  );
}

export default function OverviewTab({ claim, related, onNavigate }) {
  const currency = claim.reserveCurrency || 'USD';
  const assignment = assignmentText(claim);
  const policyHref = claim.policyId ? recordHref('policy', claim.policyId) : '';
  const claimantHref = claim.claimantPartyId ? recordHref('party', claim.claimantPartyId) : '';
  const policyEntry = related?.policy || {
    state: 'idle',
    text: claim.policyId ? shortId(claim.policyId) : ''
  };
  const claimantEntry = related?.party || {
    state: 'idle',
    text: claim.claimantPartyId ? shortId(claim.claimantPartyId) : ''
  };

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
            <dt>Assigned to</dt>
            <dd data-testid="overview-assignment">{assignment.display}</dd>
            <dt>Policy</dt>
            <dd>
              {claim.policyId ? (
                <a
                  href={policyHref}
                  onClick={openRecord}
                  data-testid="overview-policy-link"
                  title="Open policy record"
                >
                  <RelatedLabel related={policyEntry} />
                </a>
              ) : '—'}
            </dd>
            <dt>Claimant party</dt>
            <dd>
              {claim.claimantPartyId ? (
                <a
                  href={claimantHref}
                  onClick={openRecord}
                  data-testid="overview-claimant-link"
                  title="Open claimant party record"
                >
                  <RelatedLabel related={claimantEntry} />
                </a>
              ) : '—'}
            </dd>
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

      <section className="eia-context-panel" aria-label="Why this matters">
        <h4>Why this matters</h4>
        <p>
          The policy controls coverage for this claim: its terms, limits, and conditions decide whether and how
          the loss responds. Cessions and reinsurance recoveries are derived from the policy, not created on the
          claim. Reserves and settlements recorded here drive payment instructions and the financial events that
          post downstream.
        </p>
        <p>
          Ownership is an operational routing decision: the assigned adjuster and team determine the queue and
          workload that carry the claim. Assignment does not change coverage, reserves, settlements, payments,
          or any other financial outcome.
        </p>
        <p>
          Authorized or executed settlements can be handed to Payment from the Settlements tab. Payment owns
          payment approval and execution; Direct Claims keeps the settlement record and links the resulting
          payment back to this claim.
        </p>
        <div className="links">
          {claim.policyId && (
            <a href={policyHref} onClick={openRecord} data-testid="why-policy-link" title="Open policy record">
              <RelatedLabel related={policyEntry} />
            </a>
          )}
          {claim.claimantPartyId && (
            <a
              href={claimantHref}
              onClick={openRecord}
              data-testid="why-claimant-link"
              title="Open claimant party record"
            >
              <RelatedLabel related={claimantEntry} />
            </a>
          )}
        </div>
      </section>

      <RelatedRecords key={claim.policyId || 'no-policy'} claim={claim} policy={policyEntry} />

      <DocumentsCard key={claim.id} claimId={claim.id} />

      <PaymentsCard key={claim.id} claim={claim} />

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
