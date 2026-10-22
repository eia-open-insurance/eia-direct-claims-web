import React, { useEffect, useState } from 'react';
import { api, money, RELEASE_DOCUMENT_ID, REVIEWER_ID } from './api.js';
import { navigate, recordHref } from './navigation.js';
import SettlementPaymentLink from './SettlementPaymentLink.jsx';
import { DataTable, ErrorText, Field, Panel, shortId, statusTone } from './ui.jsx';

const EMPTY = {
  amount: '',
  structure: 'LUMP_SUM',
  releaseScope: 'FULL',
  paymentInstructions: ''
};

/**
 * Settlement statuses that may be handed to Payment. Direct Claims uses
 * PROPOSED -> AUTHORIZED -> EXECUTED; APPROVED and PAID are accepted for
 * compatibility with the shared settlement vocabulary.
 */
const PAYABLE_SETTLEMENT_STATUSES = ['AUTHORIZED', 'EXECUTED', 'APPROVED', 'PAID'];

/**
 * Only these direct-claims settlement states can carry a payment link. A
 * proposed settlement has not been authorized, and a denied one cannot be
 * settled; APPROVED/PAID remain payable for compatibility but are not link
 * targets in this workbench.
 */
const LINKABLE_SETTLEMENT_STATUSES = ['AUTHORIZED', 'EXECUTED'];

function isPayable(status) {
  return PAYABLE_SETTLEMENT_STATUSES.includes(String(status || '').toUpperCase());
}

function canLinkPayment(status) {
  return LINKABLE_SETTLEMENT_STATUSES.includes(String(status || '').toUpperCase());
}

/** The payment number, preferring the settlement projection over a hydrated lookup. */
function paymentNumberFor(row, paymentNumbers) {
  if (!row?.paymentId) return '';
  return row.paymentNumber || paymentNumbers[row.paymentId] || '';
}

/**
 * Cross-remote hand-off into the Payment workbench. Direct Claims never creates
 * the payment: the URL carries the source claim, amount, currency, and payee so
 * Payment can confirm them and save the DRAFT through POST /api/v1/payments.
 */
function paymentHref(claim, settlement) {
  const params = new URLSearchParams();
  params.set('new', '1');
  params.set('sourceType', 'DIRECT_CLAIM');
  params.set('sourceId', claim.id);
  params.set('sourceReference', claim.claimNumber || '');
  params.set('amount', settlement.amount == null ? '' : String(settlement.amount));
  params.set('currency', settlement.currency || claim.reserveCurrency || 'USD');
  if (claim.claimantPartyId) params.set('payeePartyId', claim.claimantPartyId);
  return `/payment?${params.toString()}`;
}

/** The payment search envelope may be returned as an array or wrapped in items. */
function paymentItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

/**
 * Normalizes a Payment DTO or a shared-search item into the row rendered in the
 * related-payments table. The search endpoint matches the claim id because the
 * hand-off stores sourceType=DIRECT_CLAIM and sourceId=<claimId>.
 */
function relatedPayment(row, fallbackCurrency) {
  const id = row?.id || '';
  return {
    id,
    paymentNumber: row?.paymentNumber || row?.label || (id ? shortId(id) : '—'),
    status: row?.status || '',
    amount: row?.amount ?? row?.paymentAmount ?? null,
    currency: row?.currency || fallbackCurrency,
    href: id ? recordHref('payment', id) : row?.href || ''
  };
}

function openPayment(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function RelatedPayments({ claim }) {
  const [payments, setPayments] = useState([]);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let alive = true;
    setPayments([]);
    setState('loading');
    api.payments
      .search(claim.id, 5)
      .then(async (body) => {
        if (!alive) return;
        const currency = claim.reserveCurrency || 'USD';
        const rows = paymentItems(body).map((row) => relatedPayment(row, currency));
        const hydrated = await Promise.all(rows.map(async (row) => {
          if (!row.id || row.amount != null) return row;
          try {
            const detail = await api.payments.get(row.id);
            return relatedPayment({ ...row, ...detail }, currency);
          } catch {
            return row;
          }
        }));
        if (!alive) return;
        setPayments(hydrated);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setPayments([]);
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [claim.id, claim.reserveCurrency]);

  return (
    <Panel title="Related payments">
      <p style={{ margin: '0 0 4px' }}>
        Payments created from this claim in the Payment workbench. Payment owns approval and execution; an
        authorized or executed settlement can be handed off from the actions above.
      </p>
      <div data-testid="related-payments">
        {state === 'loading' && (
          <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading related payments…</p>
        )}
        {state === 'error' && (
          <p className="eia-muted" style={{ margin: '8px 0 0' }}>Related payments could not be loaded.</p>
        )}
        {state === 'ready' && (
          <DataTable
            columns={[
              {
                key: 'paymentNumber',
                label: 'Payment',
                render: (row) =>
                  row.href ? (
                    <a
                      href={row.href}
                      onClick={openPayment}
                      data-testid={`related-payment-${row.id}`}
                      title={`Open payment ${row.paymentNumber}`}
                    >
                      {row.paymentNumber}
                    </a>
                  ) : (
                    row.paymentNumber
                  )
              },
              {
                key: 'status',
                label: 'Status',
                render: (row) =>
                  row.status ? (
                    <span className={`eia-pill ${statusTone(row.status)}`}>{row.status}</span>
                  ) : (
                    '—'
                  )
              },
              {
                key: 'amount',
                label: 'Amount',
                align: 'right',
                render: (row) => (row.amount == null ? '—' : money(row.amount, row.currency))
              }
            ]}
            rows={payments}
            emptyText="No payments recorded for this claim."
          />
        )}
      </div>
    </Panel>
  );
}

export default function SettlementTab({ claim, onChanged }) {
  const [settlements, setSettlements] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentNumbers, setPaymentNumbers] = useState({});
  const [linkTarget, setLinkTarget] = useState(null);

  async function load() {
    const rows = await api.settlements.list(claim.id);
    setSettlements(rows);

    // Some projections carry only paymentId. Hydrate the payment number so the
    // Payment column can show the business key rather than a raw UUID.
    const list = Array.isArray(rows) ? rows : [];
    const missing = [
      ...new Set(
        list
          .filter((row) => row.paymentId && !row.paymentNumber)
          .map((row) => row.paymentId)
      )
    ];
    if (missing.length === 0) return;
    const entries = await Promise.all(
      missing.map(async (paymentId) => {
        try {
          const detail = await api.payments.get(paymentId);
          return [paymentId, detail?.paymentNumber || ''];
        } catch {
          return [paymentId, ''];
        }
      })
    );
    setPaymentNumbers((current) => {
      const next = { ...current };
      entries.forEach(([paymentId, number]) => {
        if (number && !next[paymentId]) next[paymentId] = number;
      });
      return next;
    });
  }

  useEffect(() => {
    setError('');
    setFormError('');
    setNotice('');
    setPaymentNumbers({});
    setLinkTarget(null);
    load().catch((cause) => setError(cause.message));
  }, [claim.id]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api.settlements.propose(claim.id, {
        amount: form.amount,
        currency: claim.reserveCurrency || 'USD',
        structure: form.structure,
        releaseScope: form.releaseScope,
        paymentInstructions: form.paymentInstructions || null
      });
      setForm(EMPTY);
      await load();
    } catch (cause) {
      setFormError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function action(settlement, kind) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (kind === 'approve') {
        await api.settlements.approve(claim.id, settlement.id, {
          approvalAuthority: 'Claims Committee',
          authorizedBy: REVIEWER_ID,
          expectedVersion: settlement.version
        });
      } else {
        await api.settlements.execute(claim.id, settlement.id, {
          releaseDocumentId: RELEASE_DOCUMENT_ID,
          paymentInstructions: settlement.paymentInstructions || 'Wire funds per release',
          expectedVersion: settlement.version
        });
      }
      await load();
      if (onChanged) await onChanged();
      setNotice(
        `${settlement.settlementNumber} ${kind === 'approve' ? 'approved' : 'executed'}.`
      );
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  /** Merges the server settlement over the row, with the known link as fallback. */
  function applyLink(settlementId, updated, fallback) {
    setSettlements((current) =>
      current.map((row) => {
        if (row.id !== settlementId) return row;
        const server = updated && updated.id === settlementId ? updated : {};
        return { ...row, ...server, ...fallback };
      })
    );
  }

  function openLink(settlement) {
    if (busy) return;
    setError('');
    setNotice('');
    setLinkTarget(settlement);
  }

  function handleLinked(updated, payment) {
    const target = linkTarget;
    if (!target) return;
    setLinkTarget(null);
    setError('');
    setPaymentNumbers((current) => ({ ...current, [payment.id]: payment.paymentNumber }));
    applyLink(target.id, updated, {
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber
    });
    setNotice(
      `${target.settlementNumber} linked to ${payment.paymentNumber}. ` +
        'Payment status and settlement paid loss are unchanged.'
    );
    if (onChanged) onChanged();
  }

  async function unlink(settlement) {
    if (busy || !settlement.paymentId) return;
    const label =
      paymentNumberFor(settlement, paymentNumbers) || shortId(settlement.paymentId);
    const confirmed = window.confirm(
      `Unlink ${label} from ${settlement.settlementNumber}?\n\n` +
        'Linking is settlement evidence only. Unlinking removes the reference; the payment ' +
        'and the settlement paid loss are not changed.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.settlements.linkPayment(claim.id, settlement.id, null);
      applyLink(settlement.id, updated, { paymentId: null, paymentNumber: null });
      setNotice(`${settlement.settlementNumber} unlinked from ${label}.`);
      if (onChanged) await onChanged();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice && (
        <p role="status" data-testid="settlement-status" style={{ margin: '0 0 12px' }}>
          {notice}
        </p>
      )}

      <Panel title="Settlements">
        <DataTable
          columns={[
            { key: 'settlementNumber', label: 'Number' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => money(row.amount, row.currency) },
            { key: 'structure', label: 'Structure' },
            { key: 'status', label: 'Status' },
            {
              key: 'payment',
              label: 'Payment',
              render: (row) => {
                if (!row.paymentId) {
                  return <span data-testid={`settlement-payment-${row.id}`}>—</span>;
                }
                const number = paymentNumberFor(row, paymentNumbers);
                const label = number || shortId(row.paymentId);
                return (
                  <a
                    className="eia-mono"
                    href={recordHref('payment', row.paymentId)}
                    onClick={openPayment}
                    data-testid={`settlement-payment-${row.id}`}
                    title={`Open payment ${label}`}
                  >
                    {label}
                  </a>
                );
              }
            },
            { key: 'approvalAuthority', label: 'Authority', render: (row) => row.approvalAuthority || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    disabled={busy || row.status !== 'PROPOSED'}
                    onClick={() => action(row, 'approve')}
                  >
                    {`Approve ${row.settlementNumber}`}
                  </button>
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    disabled={busy || row.status !== 'AUTHORIZED'}
                    onClick={() => action(row, 'execute')}
                  >
                    {`Execute ${row.settlementNumber}`}
                  </button>
                  {canLinkPayment(row.status) && !row.paymentId && (
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      disabled={busy}
                      onClick={() => openLink(row)}
                      data-testid={`link-payment-${row.id}`}
                      title={`Link a PAID payment to ${row.settlementNumber}`}
                    >
                      Link payment
                    </button>
                  )}
                  {canLinkPayment(row.status) && row.paymentId && (
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      disabled={busy}
                      onClick={() => unlink(row)}
                      data-testid={`unlink-payment-${row.id}`}
                      title={`Unlink the payment from ${row.settlementNumber}`}
                    >
                      Unlink
                    </button>
                  )}
                  {isPayable(row.status) && (
                    <a
                      className="eia-btn-secondary"
                      href={paymentHref(claim, row)}
                      onClick={openPayment}
                      data-testid={`create-payment-${row.id}`}
                      title={`Create a payment for ${row.settlementNumber}`}
                    >
                      Create payment
                    </a>
                  )}
                </span>
              )
            }
          ]}
          rows={settlements}
          emptyText="No settlement."
        />
        {error && (
          <div data-testid="settlement-error">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <p className="eia-muted" data-testid="settlement-link-context" style={{ margin: '10px 0 0' }}>
          Linking a payment to an authorized or executed settlement records evidence that the
          payment settled it. Linking does not change the payment status or the settlement&apos;s
          paid loss; Payment remains the system of record.
        </p>
      </Panel>

      <RelatedPayments claim={claim} />

      <Panel title="Propose a settlement">
        <form onSubmit={submit} className="eia-form-grid">
          <Field label="Settlement amount">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={update('amount')}
              required
            />
          </Field>
          <Field label="Settlement structure">
            <select value={form.structure} onChange={update('structure')}>
              <option value="LUMP_SUM">Lump sum</option>
              <option value="STRUCTURED">Structured</option>
              <option value="ANNUITY">Annuity</option>
              <option value="MATRIX">Matrix</option>
            </select>
          </Field>
          <Field label="Release scope">
            <select value={form.releaseScope} onChange={update('releaseScope')}>
              <option value="FULL">Full</option>
              <option value="PARTIAL">Partial</option>
              <option value="CLAIMANT_SPECIFIC">Claimant specific</option>
              <option value="POLICY_YEAR">Policy year</option>
            </select>
          </Field>
          <Field label="Payment instructions">
            <input value={form.paymentInstructions} onChange={update('paymentInstructions')} />
          </Field>
          <button type="submit" disabled={busy}>Propose settlement</button>
        </form>
        <ErrorText>{formError}</ErrorText>
      </Panel>

      {linkTarget && canLinkPayment(linkTarget.status) && (
        <SettlementPaymentLink
          claim={claim}
          settlement={linkTarget}
          settlements={settlements}
          createPaymentHref={paymentHref(claim, linkTarget)}
          onClose={() => setLinkTarget(null)}
          onLinked={handleLinked}
        />
      )}
    </>
  );
}
