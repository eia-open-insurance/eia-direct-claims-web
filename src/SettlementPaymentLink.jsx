import React, { useCallback, useEffect, useState } from 'react';
import { api, money } from './api.js';
import { navigate } from './navigation.js';
import { humanize, shortId, statusTone } from './ui.jsx';

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
  width: 'min(820px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

/** The payment list endpoint may return a bare array or an envelope. */
function paymentItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

function paymentOption(row, fallbackCurrency) {
  const id = row?.id || '';
  return {
    id,
    paymentNumber: row?.paymentNumber || row?.label || (id ? shortId(id) : '—'),
    paymentType: row?.paymentType || '',
    status: String(row?.status || '').toUpperCase(),
    sourceType: String(row?.sourceType || '').toUpperCase(),
    sourceId: row?.sourceId || '',
    amount: row?.amount ?? row?.paymentAmount ?? null,
    currency: row?.currency || fallbackCurrency,
    paidDate: row?.paymentDate || row?.paidDate || ''
  };
}

function openPayment(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

/**
 * Links an existing PAID claim payment to an authorized or executed
 * settlement. The Payment remote owns the payment lifecycle; this dialog only
 * records settlement evidence, so it never approves, executes, or edits the
 * payment and never changes the settlement amount or paid loss.
 */
export default function SettlementPaymentLink({
  claim,
  settlement,
  settlements = [],
  createPaymentHref,
  onClose,
  onLinked
}) {
  const [payments, setPayments] = useState([]);
  const [state, setState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    setSelectedId('');
    try {
      const body = await api.payments.listBySource('DIRECT_CLAIM', claim.id);
      const currency = settlement.currency || claim.reserveCurrency || 'USD';
      setPayments(paymentItems(body).map((row) => paymentOption(row, currency)));
      setState('ready');
    } catch (cause) {
      setLoadError(cause.message || 'Related claim payments could not be loaded.');
      setState('error');
    }
  }, [claim.id, claim.reserveCurrency, settlement.currency]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !applying) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applying, onClose]);

  const paymentsScoped = payments.filter(
    (payment) =>
      (!payment.sourceType || payment.sourceType === 'DIRECT_CLAIM') &&
      (!payment.sourceId || payment.sourceId === claim.id)
  );
  const paid = paymentsScoped.filter((payment) => payment.status === 'PAID');
  const notPaid = paymentsScoped.length - paid.length;
  const selected = paid.find((payment) => payment.id === selectedId) || null;

  // A payment should settle one settlement. Show payments linked elsewhere on
  // this claim, but keep them unselectable so a double link is impossible.
  const linkedTo = new Map();
  settlements.forEach((row) => {
    if (row.id !== settlement.id && row.paymentId) {
      linkedTo.set(row.paymentId, row.settlementNumber || 'another settlement');
    }
  });

  async function submit(event) {
    event.preventDefault();
    if (!selected || applying) return;
    setApplying(true);
    setApplyError('');
    try {
      const updated = await api.settlements.linkPayment(claim.id, settlement.id, selected.id);
      onLinked(updated, selected);
    } catch (cause) {
      setApplyError(cause.message || 'The payment link could not be saved.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      style={OVERLAY_STYLE}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !applying) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-settlement-payment-title"
        aria-describedby="link-settlement-payment-description"
        className="eia-card"
        style={DIALOG_STYLE}
        data-testid="link-payment-dialog"
      >
        <div className="eia-record-title">
          <div>
            <h2 id="link-settlement-payment-title" style={{ margin: 0 }}>
              Link payment to {settlement.settlementNumber}
            </h2>
            <p className="eia-record-subtitle" data-testid="link-payment-settlement-context">
              {claim.claimNumber || claim.id} · {money(settlement.amount, settlement.currency)} ·
              source <b>DIRECT_CLAIM</b>
            </p>
          </div>
          <button
            type="button"
            className="eia-btn-ghost"
            onClick={onClose}
            disabled={applying}
          >
            Close
          </button>
        </div>

        <p className="eia-muted" id="link-settlement-payment-description" style={{ margin: '10px 0 0' }}>
          Choose an existing PAID payment created from this claim. Only a payment the Payment
          workbench has already approved and paid can be linked.
        </p>

        {state === 'loading' && (
          <p className="eia-muted" role="status" data-testid="link-payment-loading" style={{ margin: '12px 0 0' }}>
            Loading related claim payments…
          </p>
        )}

        {state === 'error' && (
          <div data-testid="link-payment-error" style={{ marginTop: 12 }}>
            <p role="alert" style={{ margin: 0 }}>{loadError}</p>
            <button type="button" className="eia-btn-secondary" onClick={load} style={{ marginTop: 8 }}>
              Retry
            </button>
          </div>
        )}

        {state === 'ready' && paid.length === 0 && (
          <div className="eia-empty" data-testid="link-payment-empty" style={{ marginTop: 12 }}>
            <p><b>No PAID claim payments are available.</b></p>
            <p>
              Create a payment for this claim in the Payment workbench, then approve and pay it.
              Only a payment with source <b>DIRECT_CLAIM</b> and status <b>PAID</b> can be linked
              to this settlement.
            </p>
            {notPaid > 0 && (
              <p className="eia-muted" data-testid="link-payment-not-paid">
                {notPaid} related payment{notPaid === 1 ? '' : 's'} {notPaid === 1 ? 'is' : 'are'} not
                PAID yet.
              </p>
            )}
            <div className="links">
              <a
                href={createPaymentHref}
                onClick={openPayment}
                data-testid="link-payment-create"
              >
                Create payment in Payment
              </a>
              <a href="/payment" onClick={openPayment}>
                Open Payment workbench
              </a>
            </div>
          </div>
        )}

        {state === 'ready' && paid.length > 0 && (
          <form onSubmit={submit} style={{ marginTop: 12 }}>
            {linkedTo.size > 0 && (
              <p className="eia-muted" data-testid="link-payment-linked-note" style={{ margin: '0 0 8px' }}>
                Payments already linked to another settlement are shown but cannot be selected.
              </p>
            )}
            <div className="eia-table-wrap">
              <table className="eia-table" aria-label="Related claim payments">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Payment</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Paid date</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((payment) => {
                    const linkedSettlement = linkedTo.get(payment.id);
                    return (
                      <tr key={payment.id} data-testid={`payment-option-${payment.id}`}>
                        <td>
                          <input
                            type="radio"
                            name="link-settlement-payment"
                            value={payment.id}
                            aria-label={`Select ${payment.paymentNumber}`}
                            checked={selectedId === payment.id}
                            disabled={Boolean(linkedSettlement) || applying}
                            onChange={() => setSelectedId(payment.id)}
                          />
                        </td>
                        <td>
                          <code className="eia-mono" data-testid={`payment-option-number-${payment.id}`}>
                            {payment.paymentNumber}
                          </code>
                          {linkedSettlement && (
                            <span
                              className="eia-pill blue"
                              style={{ marginLeft: 6 }}
                              data-testid={`payment-option-linked-${payment.id}`}
                            >
                              Linked to {linkedSettlement}
                            </span>
                          )}
                        </td>
                        <td>{humanize(payment.paymentType)}</td>
                        <td>
                          <span className={`eia-pill ${statusTone(payment.status)}`}>
                            {payment.status || '—'}
                          </span>
                        </td>
                        <td>{payment.amount == null ? '—' : money(payment.amount, payment.currency)}</td>
                        <td>{payment.paidDate || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {applyError && (
              <p role="alert" data-testid="apply-payment-link-error" style={{ margin: '10px 0 0' }}>
                {applyError}
              </p>
            )}

            <div className="eia-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="eia-btn-secondary" onClick={onClose} disabled={applying}>
                Cancel
              </button>
              <button type="submit" data-testid="apply-payment-link" disabled={!selected || applying}>
                {applying ? 'Linking…' : 'Confirm link'}
              </button>
            </div>
          </form>
        )}

        <div className="eia-context-panel" data-testid="link-payment-context" style={{ marginTop: 16 }}>
          <h4>What linking does</h4>
          <p>
            <b>Records evidence only.</b> Linking records which PAID payment settled this
            settlement. It does not change the payment status, approve or execute the payment, or
            change the settlement amount, the settlement&apos;s paid loss, the reserve, or the claim
            status.
          </p>
          <p>
            <b>Payment remains the system of record.</b> Create, approve, and pay the payment in
            the Payment workbench before linking it here.
          </p>
        </div>
      </section>
    </div>
  );
}
