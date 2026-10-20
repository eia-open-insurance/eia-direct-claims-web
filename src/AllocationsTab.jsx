import React, { useEffect, useState } from 'react';
import { api, money } from './api.js';
import { navigate, recordHref } from './navigation.js';
import { RelatedLabel } from './related.jsx';
import { DataTable, Field, Panel, shortId } from './ui.jsx';

const MIN_POLICY_YEAR = 1900;
const MAX_POLICY_YEAR = 2200;
const MAX_LAYER_LENGTH = 32;

/** Percent input is human-facing (0-100); the API stores a 6-decimal fraction. */
const FRACTION_SCALE = 1_000_000;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowId(row) {
  return row?.allocationId || row?.id || '';
}

function sumBy(rows, field) {
  return rows.reduce((total, row) => total + toNumber(row?.[field]), 0);
}

/**
 * The domain returns `{items, totalPct, totalAmount}`. A bare array is
 * tolerated as well so an older or wrapped payload still renders.
 */
function normalizeSummary(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  return {
    items,
    totalPct: body?.totalPct == null ? sumBy(items, 'allocationPct') : toNumber(body.totalPct),
    totalAmount:
      body?.totalAmount == null ? sumBy(items, 'allocatedAmount') : toNumber(body.totalAmount)
  };
}

function formatPercent(fraction) {
  return `${(toNumber(fraction) * 100).toFixed(2)}%`;
}

function defaultForm(claim) {
  const lossYear = Number(String(claim?.lossDate || '').slice(0, 4));
  const year =
    Number.isInteger(lossYear) && lossYear >= MIN_POLICY_YEAR && lossYear <= MAX_POLICY_YEAR
      ? lossYear
      : new Date().getFullYear();
  return {
    policyYear: String(year),
    layer: '',
    allocationPercent: '',
    allocatedAmount: ''
  };
}

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function policyLabel(related, policyId) {
  return related?.policy?.text || shortId(policyId);
}

export default function AllocationsTab({ claim, related, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(() => defaultForm(claim));
  const [formError, setFormError] = useState('');
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const currency = claim.reserveCurrency || 'USD';
  const policyHref = claim.policyId ? recordHref('policy', claim.policyId) : '';
  const items = summary?.items || [];
  const totalPct = summary?.totalPct || 0;
  const totalAmount = summary?.totalAmount || 0;
  const remainingPct = Math.max(0, 100 - totalPct * 100);
  const reserve = toNumber(claim.currentReserveAmount ?? claim.reserveAmount);
  const unallocated = Math.max(0, reserve - totalAmount);
  const overReserve = Boolean(summary) && totalAmount > reserve;

  const enteredPercent = Number(form.allocationPercent);
  const afterPercent =
    Number.isFinite(enteredPercent) && enteredPercent > 0
      ? Math.max(0, remainingPct - enteredPercent)
      : remainingPct;

  const formDisabled = busy || loading || Boolean(loadError) || !claim.policyId;

  function applySummary(body) {
    const next = normalizeSummary(body);
    setSummary(next);
    setLoadError('');
    return next;
  }

  async function fetchSummary() {
    return normalizeSummary(await api.allocations.list(claim.id));
  }

  // Reload whenever the selected claim changes. The tab owns its own loading,
  // error, and empty states so an unavailable allocation ledger never blocks
  // the claim record or the other tabs.
  useEffect(() => {
    let alive = true;
    setSummary(null);
    setForm(defaultForm(claim));
    setLoading(true);
    setLoadError('');
    setFormError('');
    setStale(false);
    setStatus('');

    api.allocations
      .list(claim.id)
      .then((body) => {
        if (!alive) return;
        applySummary(body);
      })
      .catch((cause) => {
        if (!alive) return;
        setLoadError(cause.message || 'Policy-year allocations could not be loaded.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.id]);

  async function retry() {
    setLoading(true);
    setLoadError('');
    try {
      applySummary(await fetchSummary());
    } catch (cause) {
      setLoadError(cause.message || 'Policy-year allocations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  /**
   * Validates the whole entry before the POST: the percentage across the claim
   * may not exceed 1, so the client catches the common over-allocation before
   * the server has to reject it. The server remains authoritative.
   */
  function validate() {
    if (!claim.policyId) {
      return { message: 'This claim has no policy to allocate against.' };
    }
    const year = Number(form.policyYear);
    if (!Number.isInteger(year) || year < MIN_POLICY_YEAR || year > MAX_POLICY_YEAR) {
      return {
        message: `Policy year must be a whole year between ${MIN_POLICY_YEAR} and ${MAX_POLICY_YEAR}.`
      };
    }
    const layer = form.layer.trim();
    if (!layer) {
      return { message: 'Enter the policy layer, for example PRIMARY or EXCESS_1.' };
    }
    if (layer.length > MAX_LAYER_LENGTH) {
      return { message: `Layer must be at most ${MAX_LAYER_LENGTH} characters.` };
    }
    const percent = Number(form.allocationPercent);
    if (!Number.isFinite(percent) || percent <= 0) {
      return { message: 'Enter an allocation percent greater than 0.' };
    }
    if (percent > 100) {
      return { message: 'Allocation percent must be at most 100.' };
    }
    const scaled = Math.round((percent / 100) * FRACTION_SCALE);
    if (scaled <= 0) {
      return { message: 'Allocation percent is too small to record.' };
    }
    if (Math.round(totalPct * FRACTION_SCALE) + scaled > FRACTION_SCALE) {
      const wouldTotal = (Math.round(totalPct * FRACTION_SCALE) + scaled) / (FRACTION_SCALE / 100);
      return {
        message: `Allocations would total ${wouldTotal.toFixed(2)}%, which exceeds 100%. ${formatPercent(
          remainingPct / 100
        )} remains for this claim.`
      };
    }
    if (form.allocatedAmount === '') {
      return { message: 'Enter the allocated amount.' };
    }
    const amount = Number(form.allocatedAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return { message: 'Allocated amount must be zero or a positive number.' };
    }
    return { fraction: scaled / FRACTION_SCALE };
  }

  async function submit(event) {
    event.preventDefault();
    setFormError('');
    setStale(false);
    setStatus('');

    const validation = validate();
    if (validation.message) {
      setFormError(validation.message);
      return;
    }

    setBusy(true);
    try {
      const created = await api.allocations.create(claim.id, {
        policyId: claim.policyId,
        policyYear: Number(form.policyYear),
        layer: form.layer.trim(),
        allocationPct: validation.fraction,
        allocatedAmount: form.allocatedAmount
      });

      // Show the server answer immediately, then reconcile with the ledger
      // totals. A refresh failure leaves the saved row and a reconcile hint.
      const row = created && typeof created === 'object' ? created : {};
      setSummary((current) => {
        const base = current || { items: [], totalPct: 0, totalAmount: 0 };
        const nextItems = [...base.items.filter((entry) => rowId(entry) !== rowId(row)), row];
        return {
          items: nextItems,
          totalPct: base.totalPct + toNumber(row.allocationPct),
          totalAmount: base.totalAmount + toNumber(row.allocatedAmount)
        };
      });
      setForm(defaultForm(claim));
      const successText =
        row.policyYear != null
          ? `Allocated ${formatPercent(row.allocationPct)} (${money(
              row.allocatedAmount,
              currency
            )}) to policy year ${row.policyYear} · ${row.layer}.`
          : 'Allocation recorded.';
      setStatus(successText);

      try {
        applySummary(await fetchSummary());
      } catch {
        setStatus(`${successText} Reload the allocations to reconcile the claim totals.`);
      }
      if (onChanged) {
        await onChanged();
      }
    } catch (cause) {
      if (cause.status === 409) {
        setStale(true);
        setFormError(
          `${
            cause.message || 'The allocation was rejected because the claim allocations exceed 100%.'
          } The allocations changed since this form was loaded; reload the allocations and adjust the percentage.`
        );
      } else {
        setFormError(cause.message || 'The allocation could not be recorded.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadAllocations() {
    setStale(false);
    setFormError('');
    try {
      applySummary(await fetchSummary());
    } catch (cause) {
      setFormError(cause.message || 'The allocations could not be reloaded.');
    }
  }

  return (
    <>
      <section className="eia-summary-grid" aria-label="Allocation summary">
        <div className="eia-card">
          <h3>Allocated amount</h3>
          <div className="value" data-testid="summary-allocated-amount">
            {loading ? '…' : summary ? money(totalAmount, currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {summary ? `Across ${items.length} allocation${items.length === 1 ? '' : 's'}` : 'Policy-year split'}
          </div>
        </div>
        <div className="eia-card">
          <h3>Allocated %</h3>
          <div className="value" data-testid="summary-allocated-pct">
            {loading ? '…' : summary ? formatPercent(totalPct) : '—'}
          </div>
          <div className="eia-metric-label">Of the claim loss</div>
        </div>
        <div className="eia-card">
          <h3>Unallocated amount</h3>
          <div className="value" data-testid="summary-unallocated">
            {loading ? '…' : summary ? money(unallocated, currency) : '—'}
          </div>
          <div className="eia-metric-label">
            {overReserve
              ? `Allocated exceeds the current reserve by ${money(totalAmount - reserve, currency)}`
              : `Current reserve ${money(reserve, currency)} minus allocated`}
          </div>
        </div>
        <div className="eia-card">
          <h3>Allocations</h3>
          <div className="value" data-testid="summary-allocation-count">
            {loading ? '…' : summary ? items.length : '—'}
          </div>
          <div className="eia-metric-label">Policy-year and layer rows</div>
        </div>
      </section>

      <Panel title="Policy-year allocations">
        <p className="eia-muted" style={{ marginTop: 0 }}>
          The claim loss is distributed across policy years and layers. Percentages are shares of the
          claim and must total no more than 100%.
        </p>

        {loading ? (
          <p className="eia-muted" role="status" data-testid="allocations-loading" style={{ margin: '12px 0 0' }}>
            Loading policy-year allocations…
          </p>
        ) : loadError ? (
          <div data-testid="allocations-error">
            <p role="alert" style={{ margin: '12px 0 0' }}>{loadError}</p>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={retry}
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              Retry allocations
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="eia-empty" data-testid="allocations-empty" style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>No policy-year allocations recorded for this claim.</p>
            <p style={{ marginTop: 0 }}>
              Use the form below to distribute the loss across policy years and layers.
            </p>
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'policyYear', label: 'Policy year', align: 'right' },
              { key: 'layer', label: 'Layer', render: (row) => row.layer || '—' },
              {
                key: 'allocationPct',
                label: 'Allocation %',
                align: 'right',
                render: (row) => formatPercent(row.allocationPct)
              },
              {
                key: 'allocatedAmount',
                label: 'Allocated amount',
                align: 'right',
                render: (row) => money(row.allocatedAmount, currency)
              },
              {
                key: 'policy',
                label: 'Policy',
                render: (row) => {
                  const policyId = row.policyId || claim.policyId;
                  if (!policyId) return '—';
                  return (
                    <a
                      href={recordHref('policy', policyId)}
                      onClick={openRecord}
                      data-testid="allocation-policy-link"
                      title="Open policy record"
                    >
                      {policyLabel(related, policyId)}
                    </a>
                  );
                }
              }
            ]}
            rows={items}
            emptyText="No policy-year allocations recorded for this claim."
          />
        )}
      </Panel>

      <Panel title="Allocate the claim to a policy year and layer">
        <form className="eia-form-grid" onSubmit={submit} aria-label="Record an allocation">
          <div className="eia-field span-2">
            <span>Policy (fixed to this claim)</span>
            <span style={{ fontWeight: 600 }} data-testid="allocation-policy">
              {claim.policyId ? (
                <a href={policyHref} onClick={openRecord} title="Open policy record">
                  <RelatedLabel related={related?.policy} />
                </a>
              ) : (
                'No policy on this claim.'
              )}
            </span>
          </div>
          <Field label="Policy year">
            <input
              id="allocationPolicyYear"
              type="number"
              min={MIN_POLICY_YEAR}
              max={MAX_POLICY_YEAR}
              step="1"
              value={form.policyYear}
              onChange={update('policyYear')}
              required
              disabled={formDisabled}
            />
          </Field>
          <Field label="Layer">
            <input
              id="allocationLayer"
              value={form.layer}
              onChange={update('layer')}
              maxLength={MAX_LAYER_LENGTH}
              placeholder="PRIMARY or EXCESS_1"
              required
              disabled={formDisabled}
            />
          </Field>
          <Field label="Allocation percent">
            <input
              id="allocationPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.allocationPercent}
              onChange={update('allocationPercent')}
              placeholder="0 to 100"
              required
              disabled={formDisabled}
              aria-label="Allocation percent"
              aria-describedby="allocation-remaining-hint"
            />
            <span
              id="allocation-remaining-hint"
              className="eia-picker-hint"
              data-testid="allocation-remaining-percent"
            >
              {formatPercent(remainingPct / 100)} remaining
              {Number.isFinite(enteredPercent) && enteredPercent > 0
                ? ` · ${formatPercent(afterPercent / 100)} after this entry`
                : ''}
            </span>
          </Field>
          <Field label="Allocated amount">
            <input
              id="allocationAmount"
              type="number"
              min="0"
              step="0.01"
              value={form.allocatedAmount}
              onChange={update('allocatedAmount')}
              placeholder={currency}
              required
              disabled={formDisabled}
              aria-label="Allocated amount"
              aria-describedby="allocation-amount-hint"
            />
            <span id="allocation-amount-hint" className="eia-picker-hint">
              Recorded as entered; not recalculated from the reserve.
            </span>
          </Field>

          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={formDisabled}>
              {busy ? 'Recording…' : 'Record allocation'}
            </button>
          </div>
        </form>

        {status && (
          <p role="status" data-testid="allocations-status" style={{ margin: '10px 0 0' }}>
            {status}
          </p>
        )}

        {formError && (
          <div data-testid={stale ? 'allocations-stale' : 'allocations-form-error'}>
            <p role="alert" style={{ margin: '10px 0 0' }}>{formError}</p>
            {stale && (
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={reloadAllocations}
                disabled={busy}
                style={{ marginTop: 8 }}
              >
                Reload allocations
              </button>
            )}
          </div>
        )}
      </Panel>

      <section className="eia-context-panel" aria-label="Why this matters">
        <h4>Why this matters</h4>
        <p>
          An allocation distributes the claim loss across policy years and layers. It does not change the
          claim reserve or the coverage position, and it does not move the reserve ledger. Policy owns the
          limit ledger: the policy validates and tracks how the allocation erodes limits, while Direct Claims
          records the claim-side split and the unallocated comparison against the current reserve.
        </p>
      </section>
    </>
  );
}
