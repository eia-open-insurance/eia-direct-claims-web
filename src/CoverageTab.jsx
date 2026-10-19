import React, { useEffect, useState } from 'react';
import { api, REVIEWER_ID, today } from './api.js';
import { ErrorText, Field, gridStyle, Panel } from './ui.jsx';

const EMPTY = {
  position: 'COVERED',
  basis: '',
  policyProvisions: '',
  allocationMethod: 'PRO_RATA_TIME',
  allocationPct: '1.000000',
  reviewerPartyId: REVIEWER_ID,
  decisionDate: today()
};

export default function CoverageTab({ claim }) {
  const [decision, setDecision] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setDecision(await api.coverage.get(claim.id));
    } catch (cause) {
      if (cause.status === 404) {
        setDecision(null);
        return;
      }
      throw cause;
    }
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [claim.id]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const recorded = await api.coverage.decide(claim.id, {
        position: form.position,
        basis: form.basis,
        policyProvisions: form.policyProvisions || null,
        allocationMethod: form.allocationMethod || null,
        allocationPct: form.allocationPct || null,
        decisionDate: form.decisionDate,
        reviewerPartyId: form.reviewerPartyId
      });
      setDecision(recorded);
      setForm((current) => ({ ...current, basis: '' }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Coverage decision">
        {decision ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 6, margin: 0 }}>
            <dt>Position</dt>
            <dd style={{ margin: 0, fontWeight: 700 }} data-testid="coverage-position">
              {decision.position}
            </dd>
            <dt>Status</dt>
            <dd style={{ margin: 0 }}>{decision.status}</dd>
            <dt>Basis</dt>
            <dd style={{ margin: 0 }} data-testid="coverage-basis">{decision.basis}</dd>
            <dt>Policy provisions</dt>
            <dd style={{ margin: 0 }}>{decision.policyProvisions || '—'}</dd>
            <dt>Decision date</dt>
            <dd style={{ margin: 0 }}>{decision.decisionDate}</dd>
            <dt>Reviewer</dt>
            <dd style={{ margin: 0 }}>{decision.reviewerPartyId}</dd>
            <dt>Allocation</dt>
            <dd style={{ margin: 0 }}>
              {decision.allocationMethod || '—'} {decision.allocationPct ?? ''}
            </dd>
          </dl>
        ) : (
          <p style={{ margin: 0 }} data-testid="coverage-empty">No coverage decision recorded.</p>
        )}
      </Panel>

      <Panel title="Record a coverage decision">
        <form onSubmit={submit} style={gridStyle}>
          <Field label="Coverage position">
            <select value={form.position} onChange={update('position')}>
              <option value="COVERED">Covered</option>
              <option value="DENIED">Denied</option>
              <option value="DEFENSE_ONLY">Defense only</option>
            </select>
          </Field>
          <Field label="Coverage basis">
            <textarea
              value={form.basis}
              onChange={update('basis')}
              rows={2}
              required
              style={{ fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Policy provisions">
            <textarea
              value={form.policyProvisions}
              onChange={update('policyProvisions')}
              rows={2}
              style={{ fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Allocation method">
            <select value={form.allocationMethod} onChange={update('allocationMethod')}>
              <option value="PRO_RATA_TIME">Pro rata time</option>
              <option value="PRO_RATA_PREMIUM">Pro rata premium</option>
              <option value="ALL_SUMS">All sums</option>
              <option value="EQUAL">Equal</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </Field>
          <Field label="Allocation percent">
            <input value={form.allocationPct} onChange={update('allocationPct')} />
          </Field>
          <Field label="Decision date">
            <input type="date" value={form.decisionDate} onChange={update('decisionDate')} required />
          </Field>
          <Field label="Reviewer party ID">
            <input value={form.reviewerPartyId} onChange={update('reviewerPartyId')} required />
          </Field>
          <button type="submit" disabled={busy}>Record coverage decision</button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Panel>
    </>
  );
}
