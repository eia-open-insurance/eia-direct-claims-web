import React, { useEffect, useState } from 'react';
import { api, today } from './api.js';
import EntityPicker from './EntityPicker.jsx';
import { navigate } from './navigation.js';
import { partyLabel } from './related.jsx';
import { ErrorText, Field, Panel, shortId } from './ui.jsx';

const EMPTY = {
  position: 'COVERED',
  basis: '',
  policyProvisions: '',
  allocationMethod: 'PRO_RATA_TIME',
  allocationPct: '1.000000',
  reviewerPartyId: '',
  reviewerPartyLabel: '',
  decisionDate: ''
};

function emptyForm() {
  return { ...EMPTY, decisionDate: today() };
}

function partyHref(partyId) {
  return `/party?record=${encodeURIComponent(partyId)}`;
}

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

export default function CoverageTab({ claim }) {
  const [decision, setDecision] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [reviewerLabels, setReviewerLabels] = useState({});
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      return await api.coverage.get(claim.id);
    } catch (cause) {
      if (cause.status === 404) return null;
      throw cause;
    }
  }

  useEffect(() => {
    let alive = true;
    setDecision(null);
    setReviewerLabels({});
    setForm(emptyForm());
    setError('');
    setFormError('');

    /**
     * A saved decision carries only the reviewer party id. Resolve the shared
     * party label for the decision link and hydrate the picker so recording a
     * replacement decision keeps the same reviewer without another search. A
     * failed lookup keeps the short-id fallback and never blocks the record.
     */
    async function hydrate(recorded) {
      if (!alive || !recorded) return;
      setDecision(recorded);
      const reviewerId = recorded.reviewerPartyId ? String(recorded.reviewerPartyId) : '';
      if (!reviewerId) return;

      setForm((current) => ({ ...current, reviewerPartyId: reviewerId }));

      let label =
        typeof recorded.reviewerPartyLabel === 'string' ? recorded.reviewerPartyLabel : '';
      if (!label) {
        try {
          label = partyLabel(await api.parties.get(reviewerId));
        } catch {
          label = '';
        }
      }
      if (!alive || !label) return;

      setReviewerLabels((current) => ({ ...current, [reviewerId]: label }));
      setForm((current) =>
        current.reviewerPartyId === reviewerId
          ? { ...current, reviewerPartyLabel: label }
          : current
      );
    }

    load()
      .then(hydrate)
      .catch((cause) => {
        if (alive) setError(cause.message);
      });

    return () => {
      alive = false;
    };
  }, [claim.id]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  /** Keeps the selected party id and its picker label together. */
  function selectReviewer(partyId, item) {
    const id = partyId || '';
    setForm((current) => ({
      ...current,
      reviewerPartyId: id,
      reviewerPartyLabel: id ? item?.label || '' : ''
    }));
    if (id && item?.label) {
      setReviewerLabels((current) => ({ ...current, [id]: item.label }));
    }
    setFormError('');
  }

  function validate() {
    if (!form.reviewerPartyId) {
      return 'Select the reviewer party from the shared party records.';
    }
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    setFormError('');
    setError('');

    const validation = validate();
    if (validation) {
      setFormError(validation);
      return;
    }

    setBusy(true);
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
      const recordedReviewerId = recorded?.reviewerPartyId
        ? String(recorded.reviewerPartyId)
        : '';
      const recordedLabel = recordedReviewerId
        ? form.reviewerPartyLabel || reviewerLabels[recordedReviewerId] || ''
        : '';
      if (recordedReviewerId && recordedLabel) {
        setReviewerLabels((current) => ({ ...current, [recordedReviewerId]: recordedLabel }));
      }
      setForm((current) => ({
        ...current,
        basis: '',
        ...(recordedReviewerId
          ? {
              reviewerPartyId: recordedReviewerId,
              reviewerPartyLabel: recordedLabel || current.reviewerPartyLabel
            }
          : {})
      }));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function reviewerLabelFor(partyId) {
    if (!partyId) return '';
    const id = String(partyId);
    if (reviewerLabels[id]) return reviewerLabels[id];
    if (form.reviewerPartyId === id && form.reviewerPartyLabel) return form.reviewerPartyLabel;
    return shortId(id);
  }
  return (
    <>
      <Panel title="Coverage decision">
        {decision ? (
          <dl className="eia-kv">
            <dt>Position</dt>
            <dd style={{ margin: 0, fontWeight: 700 }} data-testid="coverage-position">
              {decision.position}
            </dd>
            <dt>Status</dt>
            <dd style={{ margin: 0 }}><span className="eia-badge">{decision.status}</span></dd>
            <dt>Basis</dt>
            <dd style={{ margin: 0 }} data-testid="coverage-basis">{decision.basis}</dd>
            <dt>Policy provisions</dt>
            <dd style={{ margin: 0 }}>{decision.policyProvisions || '—'}</dd>
            <dt>Decision date</dt>
            <dd style={{ margin: 0 }}>{decision.decisionDate}</dd>
            <dt>Reviewer</dt>
            <dd style={{ margin: 0 }}>
              {decision.reviewerPartyId ? (
                <a
                  href={partyHref(decision.reviewerPartyId)}
                  onClick={openRecord}
                  data-testid="coverage-reviewer-link"
                  title="Open reviewer party record"
                >
                  {reviewerLabelFor(decision.reviewerPartyId)}
                </a>
              ) : (
                '—'
              )}
            </dd>
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
        <form onSubmit={submit} className="eia-form-grid">
          <Field label="Coverage position">
            <select value={form.position} onChange={update('position')}>
              <option value="COVERED">Covered</option>
              <option value="DENIED">Denied</option>
              <option value="DEFENSE_ONLY">Defense only</option>
            </select>
          </Field>
          <Field label="Coverage basis" className="span-2">
            <textarea
              value={form.basis}
              onChange={update('basis')}
              rows={2}
              required
              style={{ fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Policy provisions" className="span-2">
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
          <Field label="Reviewer party">
            <EntityPicker
              endpoint="/api/v1/parties/search"
              value={form.reviewerPartyId}
              valueLabel={form.reviewerPartyLabel}
              onChange={selectReviewer}
              placeholder="Search reviewer party number or name…"
              disabled={busy}
            />
            {form.reviewerPartyId && (
              <span className="eia-picker-hint" data-testid="coverage-reviewer-selection">
                Selected reviewer party:{' '}
                <a
                  href={partyHref(form.reviewerPartyId)}
                  onClick={openRecord}
                  data-testid="coverage-reviewer-picker-link"
                  title="Open reviewer party record"
                >
                  {form.reviewerPartyLabel || shortId(form.reviewerPartyId)}
                </a>
              </span>
            )}
          </Field>
          <button type="submit" disabled={busy}>Record coverage decision</button>
        </form>
        {formError && (
          <div data-testid="coverage-form-error">
            <ErrorText>{formError}</ErrorText>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </Panel>

      <section
        className="eia-context-panel"
        aria-label="Coverage context"
        data-testid="coverage-context"
      >
        <h4>Coverage context</h4>
        <p>
          <b>The reviewer is a party record.</b> Choose the reviewer from the shared party master
          data. The coverage decision stores the party id and links to that party record, so the
          reviewer name and number stay owned by the party record instead of being copied onto the
          decision.
        </p>
      </section>
    </>
  );
}
