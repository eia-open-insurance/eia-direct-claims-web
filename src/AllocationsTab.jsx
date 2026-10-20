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

/**
 * Erosion is the Policy-owned consumption of the selected limit. A saved
 * allocation may exist while the post is still pending (NOT_POSTED), has been
 * applied (POSTED), or was rejected and can be retried (FAILED).
 */
const EROSION_STATUSES = ['NOT_POSTED', 'POSTED', 'FAILED'];
const EROSION_BADGES = {
  NOT_POSTED: { label: 'Not posted', tone: 'amber' },
  POSTED: { label: 'Posted', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' }
};

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

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * The Policy coverages endpoint returns `ItemPage<CoverageViewDto>` where each
 * item is `{coverage, limit, state}`. Flatten it to the selectable limits the
 * allocation form and table use: the limit id, the coverage code/type, the
 * original limit amount, and the remaining amount after prior erosion.
 */
function flattenLimitOptions(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  const options = [];
  const seen = new Set();

  items.forEach((item) => {
    const coverage = item?.coverage || {};
    const limit = item?.limit || {};
    const state = item?.state || {};
    const limitId = String(limit.id || state.limitId || item?.limitId || '');
    if (!limitId || seen.has(limitId)) return;
    seen.add(limitId);
    options.push({
      limitId,
      coverageId: coverage.id || limit.coverageId || '',
      coverageCode: coverage.coverageCode || '',
      coverageName: coverage.coverageName || '',
      coverageType: coverage.coveragePart || coverage.coverageCode || '',
      originalAmount: state.originalAmount ?? limit.aggregateAmount ?? limit.perOccurrenceAmount ?? null,
      remainingAmount: state.remainingAmount ?? null,
      currency: limit.currency || ''
    });
  });

  return options;
}

function coverageLabel(option) {
  const code = option?.coverageCode || option?.coverageType || '';
  const name = option?.coverageName || '';
  if (code && name) return `${code} · ${name}`;
  return code || name || shortId(option?.limitId);
}

function limitOptionLabel(option, fallbackCurrency) {
  const currency = option.currency || fallbackCurrency;
  const parts = [coverageLabel(option)];
  if (option.originalAmount != null) {
    parts.push(`Limit ${money(option.originalAmount, currency)}`);
  }
  if (option.remainingAmount != null) {
    parts.push(`Remaining ${money(option.remainingAmount, currency)}`);
  }
  return parts.join(' · ');
}

function erosionStatusOf(row) {
  const value = String(row?.erosionStatus || '').toUpperCase();
  return EROSION_STATUSES.includes(value) ? value : 'NOT_POSTED';
}

/** The create/retry answer may be the allocation itself or a wrapper around it. */
function readAllocation(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.allocationId) return body;
  if (body.allocation?.allocationId) return body.allocation;
  return null;
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
    allocatedAmount: '',
    limitId: ''
  };
}

/** Human-readable consequence of the erosion status on a saved allocation. */
function erosionOutcomeText(row) {
  if (!row?.limitId) {
    return ' No policy limit was selected, so no policy-limit erosion was posted.';
  }
  const status = erosionStatusOf(row);
  if (status === 'POSTED') {
    return ' Policy-limit erosion posted.';
  }
  if (status === 'FAILED') {
    return ` Policy-limit erosion failed${
      row.erosionMessage ? `: ${row.erosionMessage}` : ''
    }. The allocation is saved and can be retried.`;
  }
  return ' Policy-limit erosion is not posted yet.';
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
  const [limits, setLimits] = useState({ status: 'loading', items: [], error: '' });
  const [limitsNonce, setLimitsNonce] = useState(0);
  const [form, setForm] = useState(() => defaultForm(claim));
  const [formError, setFormError] = useState('');
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState('');
  const [retryError, setRetryError] = useState(null);

  const currency = claim.reserveCurrency || 'USD';
  const policyHref = claim.policyId ? recordHref('policy', claim.policyId) : '';
  const items = summary?.items || [];
  const totalPct = summary?.totalPct || 0;
  const totalAmount = summary?.totalAmount || 0;
  const remainingPct = Math.max(0, 100 - totalPct * 100);
  const reserve = toNumber(claim.currentReserveAmount ?? claim.reserveAmount);
  const unallocated = Math.max(0, reserve - totalAmount);
  const overReserve = Boolean(summary) && totalAmount > reserve;

  const limitOptions = limits.items;
  const limitsById = new Map(limitOptions.map((option) => [option.limitId, option]));
  const selectedLimit = form.limitId ? limitsById.get(form.limitId) || null : null;

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

  /**
   * Replaces or appends one allocation in the local ledger and recomputes the
   * totals from the rows so an erosion retry never disturbs the claim split.
   */
  function mergeSummaryRow(row) {
    setSummary((current) => {
      const base = current || { items: [], totalPct: 0, totalAmount: 0 };
      const id = rowId(row);
      const index = base.items.findIndex((entry) => rowId(entry) === id);
      const nextItems =
        index >= 0
          ? base.items.map((entry, position) =>
              position === index ? { ...entry, ...row } : entry
            )
          : [...base.items, row];
      return normalizeSummary({ items: nextItems });
    });
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
    setRetryError(null);

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

  /**
   * Limits belong to the claim's policy, so they are fetched with the tab and
   * reloaded when the claim changes. A failure is deliberately local: the
   * allocation can still be recorded without naming a limit, which means no
   * erosion is posted.
   */
  useEffect(() => {
    let alive = true;
    const policyId = claim.policyId;

    if (!policyId) {
      setLimits({ status: 'ready', items: [], error: '' });
      return () => {
        alive = false;
      };
    }

    setLimits({ status: 'loading', items: [], error: '' });
    api.policies
      .coverages(policyId)
      .then((body) => {
        if (!alive) return;
        const nextItems = flattenLimitOptions(body);
        setLimits({ status: 'ready', items: nextItems, error: '' });
        setForm((current) =>
          current.limitId && !nextItems.some((option) => option.limitId === current.limitId)
            ? { ...current, limitId: '' }
            : current
        );
      })
      .catch((cause) => {
        if (!alive) return;
        setLimits({
          status: 'error',
          items: [],
          error: cause.message || 'Policy limits could not be loaded.'
        });
      });

    return () => {
      alive = false;
    };
  }, [claim.id, claim.policyId, limitsNonce]);

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

  function retryLimits() {
    setLimitsNonce((value) => value + 1);
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
    setRetryError(null);

    const validation = validate();
    if (validation.message) {
      setFormError(validation.message);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        policyId: claim.policyId,
        policyYear: Number(form.policyYear),
        layer: form.layer.trim(),
        allocationPct: validation.fraction,
        allocatedAmount: form.allocatedAmount
      };
      // The limit is optional: no limitId means the allocation is recorded
      // without posting any policy-limit erosion.
      if (form.limitId) payload.limitId = form.limitId;

      const created = await api.allocations.create(claim.id, payload);

      // Show the server answer immediately, including its erosion status, then
      // reconcile with the ledger totals. A refresh failure leaves the saved
      // row and a reconcile hint.
      const row = created && typeof created === 'object' ? { ...created } : {};
      if (form.limitId && !row.limitId) row.limitId = form.limitId;
      mergeSummaryRow(row);
      setForm(defaultForm(claim));
      const successText = `${
        row.policyYear != null
          ? `Allocated ${formatPercent(row.allocationPct)} (${money(
              row.allocatedAmount,
              currency
            )}) to policy year ${row.policyYear} · ${row.layer}.`
          : 'Allocation recorded.'
      }${erosionOutcomeText(row)}`;
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

  /**
   * Retries the Policy erosion post for one saved allocation. A retry failure
   * never removes or changes the allocation row; it stays failed and retryable.
   */
  async function retryErosion(row) {
    const allocationId = rowId(row);
    if (!allocationId) return;

    setRetryError(null);
    setStatus('');
    setRetryingId(allocationId);
    try {
      const answer = await api.allocations.retryErosion(claim.id, allocationId);
      const updated = readAllocation(answer);

      if (updated) {
        mergeSummaryRow(updated);
        const status = erosionStatusOf(updated);
        if (status === 'POSTED') {
          setStatus(`Erosion posted to the policy limit for allocation ${row.policyYear} · ${row.layer}.`);
        } else if (status === 'FAILED') {
          setStatus(
            `Erosion retry failed${
              updated.erosionMessage ? `: ${updated.erosionMessage}` : ''
            }. The allocation is intact and can be retried.`
          );
        } else {
          setStatus('Erosion is not posted yet; the allocation is intact and can be retried.');
        }
      } else {
        // Some deployments answer the retry with an accepted-but-empty body;
        // reconcile the row from the ledger in that case.
        applySummary(await fetchSummary());
        setStatus('Erosion retry requested. The allocation row shows the latest status.');
      }
    } catch (cause) {
      setRetryError({
        allocationId,
        message: cause.message || 'The erosion retry could not be posted.'
      });
    } finally {
      setRetryingId('');
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

  function renderLimit(row) {
    if (!row.limitId) {
      return (
        <span className="eia-muted" data-testid="allocation-limit-none">
          No limit
        </span>
      );
    }
    const option = limitsById.get(String(row.limitId));
    if (!option) {
      return (
        <span data-testid="allocation-limit" title={String(row.limitId)}>
          {shortId(row.limitId)}
        </span>
      );
    }
    return (
      <span data-testid="allocation-limit" title={limitOptionLabel(option, currency)}>
        {coverageLabel(option)}
        {option.originalAmount != null
          ? ` · ${money(option.originalAmount, option.currency || currency)}`
          : ''}
      </span>
    );
  }

  function renderErosion(row) {
    const status = erosionStatusOf(row);

    // A row without a limit never posts erosion; it is not a pending post.
    if (!row.limitId && status === 'NOT_POSTED') {
      return (
        <span className="eia-muted" data-testid="allocation-erosion-none">
          No erosion
        </span>
      );
    }

    const badge = EROSION_BADGES[status];
    const allocationId = rowId(row);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <span className={`eia-pill ${badge.tone}`} data-testid="allocation-erosion-badge">
          {badge.label}
        </span>
        {status === 'POSTED' && row.erosionPostedAt && (
          <span className="eia-muted" data-testid="allocation-erosion-posted-at" style={{ fontSize: 10 }}>
            {formatTimestamp(row.erosionPostedAt)}
          </span>
        )}
        {status === 'FAILED' && (
          <>
            <span
              data-testid="allocation-erosion-message"
              style={{ color: 'var(--eia-red)', fontSize: 11 }}
            >
              {row.erosionMessage || 'Erosion posting failed.'}
            </span>
            <button
              type="button"
              className="eia-btn-secondary"
              data-testid="allocation-erosion-retry"
              onClick={() => retryErosion(row)}
              disabled={Boolean(retryingId)}
              aria-label={`Retry erosion for policy year ${row.policyYear}`}
              style={{ padding: '2px 8px', fontSize: 11 }}
            >
              {retryingId === allocationId ? 'Retrying…' : 'Retry erosion'}
            </button>
            {retryError?.allocationId === allocationId && (
              <span
                role="alert"
                data-testid="allocation-erosion-error"
                style={{ color: 'var(--eia-red)', fontSize: 11 }}
              >
                {retryError.message}
              </span>
            )}
          </>
        )}
      </div>
    );
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
          claim and must total no more than 100%. An allocation can optionally consume a policy limit;
          Policy applies the erosion and returns its status.
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
              { key: 'policyLimit', label: 'Policy limit', render: renderLimit },
              { key: 'erosion', label: 'Erosion', render: renderErosion },
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
          <Field label="Policy limit" className="span-2">
            <select
              id="allocationLimit"
              value={form.limitId}
              onChange={update('limitId')}
              disabled={formDisabled || limits.status === 'loading'}
              aria-label="Policy limit"
              aria-describedby="allocation-limit-hint"
              data-testid="allocation-limit-select"
            >
              <option value="">No policy limit (no erosion)</option>
              {limitOptions.map((option) => (
                <option key={option.limitId} value={option.limitId}>
                  {limitOptionLabel(option, currency)}
                </option>
              ))}
            </select>
            {limits.status === 'loading' && (
              <span className="eia-picker-hint" data-testid="allocation-limits-loading">
                Loading policy coverages and limits…
              </span>
            )}
            {limits.status === 'error' && (
              <span className="eia-picker-hint" data-testid="allocation-limits-error">
                <span role="alert">Policy limits could not be loaded: {limits.error}</span>
                <button
                  type="button"
                  className="eia-btn-ghost"
                  onClick={(event) => {
                    // The hint lives inside the field label; keep the label
                    // from also activating the select when retrying.
                    event.preventDefault();
                    event.stopPropagation();
                    retryLimits();
                  }}
                  disabled={formDisabled}
                  style={{ marginLeft: 8 }}
                >
                  Retry limits
                </button>
              </span>
            )}
            {limits.status === 'ready' && limitOptions.length === 0 && (
              <span className="eia-picker-hint" data-testid="allocation-limits-empty">
                {claim.policyId
                  ? 'This policy has no coverage limits, so no erosion can be posted.'
                  : 'This claim has no policy, so no policy limits are available.'}
              </span>
            )}
            {selectedLimit ? (
              <span
                id="allocation-limit-hint"
                className="eia-picker-hint"
                data-testid="allocation-limit-detail"
              >
                Coverage {coverageLabel(selectedLimit)}
                {selectedLimit.originalAmount != null
                  ? ` · Limit ${money(
                      selectedLimit.originalAmount,
                      selectedLimit.currency || currency
                    )}`
                  : ''}
                {selectedLimit.remainingAmount != null
                  ? ` · Remaining ${money(
                      selectedLimit.remainingAmount,
                      selectedLimit.currency || currency
                    )}`
                  : ''}
              </span>
            ) : (
              <span
                id="allocation-limit-hint"
                className="eia-picker-hint"
                data-testid="allocation-limit-hint"
              >
                No policy limit selected. The allocation is still recorded; no policy-limit erosion
                is posted.
              </span>
            )}
          </Field>
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
          An allocation distributes the claim loss across policy years and layers and can consume a
          selected policy limit. Posting an allocation with a policy limit sends an erosion fact to
          Policy, which owns the limit ledger and reduces that limit&apos;s remaining amount. If the
          erosion post fails, the allocation itself is kept intact and can be retried; an allocation
          with no selected limit is recorded without eroding any policy limit. Allocation does not
          change the claim reserve or the coverage position.
        </p>
      </section>
    </>
  );
}
