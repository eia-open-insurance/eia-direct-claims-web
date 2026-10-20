import React, { useEffect, useState } from 'react';
import { api, money } from './api.js';
import { DataTable, ErrorText, Field, Panel } from './ui.jsx';

const EMPTY = {
  component: 'INDEMNITY',
  amount: '',
  reasonCode: 'INITIAL',
  reasonText: '',
  authority: 'Manager'
};

export default function ReserveTab({ claim, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setSummary(await api.reserves.get(claim.id));
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
      await api.reserves.change(claim.id, {
        component: form.component,
        amount: form.amount,
        currency: claim.reserveCurrency || 'USD',
        effectiveDate: claim.reportDate,
        reasonCode: form.reasonCode,
        reasonText: form.reasonText || null,
        authority: form.authority || null,
        expectedVersion: claim.version
      });
      setForm(EMPTY);
      await load();
      if (onChanged) {
        await onChanged();
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  const history = summary?.history || [];
  const components = summary?.components || [];

  return (
    <>
      <Panel title="Reserve history">
        <p style={{ marginTop: 0 }}>
          Current reserve:{' '}
          <strong data-testid="current-reserve">
            {money(summary?.totalCurrentAmount ?? 0, summary?.currency || 'USD')}
          </strong>
        </p>
        <DataTable
          columns={[
            { key: 'component', label: 'Component' },
            {
              key: 'currentAmount',
              label: 'Current amount',
              align: 'right',
              render: (row) => money(row.currentAmount, row.currency)
            }
          ]}
          rows={components}
          emptyText="No current reserve component."
        />
      </Panel>

      <Panel title="Post a reserve change">
        <form onSubmit={submit} className="eia-form-grid">
          <Field label="Reserve component">
            <select value={form.component} onChange={update('component')}>
              <option value="INDEMNITY">Indemnity</option>
              <option value="DEFENSE">Defense</option>
              <option value="ALAE">ALAE</option>
              <option value="ULAE">ULAE</option>
              <option value="EXPENSE">Expense</option>
              <option value="MEDICAL">Medical</option>
              <option value="IBNR">IBNR</option>
              <option value="IBNER">IBNER</option>
            </select>
          </Field>
          <Field label="Reserve change amount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={update('amount')}
              required
            />
          </Field>
          <Field label="Reserve reason">
            <select value={form.reasonCode} onChange={update('reasonCode')}>
              <option value="INITIAL">Initial</option>
              <option value="DEVELOPMENT">Development</option>
              <option value="NEW_INFORMATION">New information</option>
              <option value="SETTLEMENT_NEGOTIATION">Settlement negotiation</option>
              <option value="COVERAGE_CHANGE">Coverage change</option>
              <option value="REVIEW">Review</option>
              <option value="CORRECTION">Correction</option>
              <option value="CLOSE">Close</option>
            </select>
          </Field>
          <Field label="Reserve authority">
            <input value={form.authority} onChange={update('authority')} />
          </Field>
          <Field label="Reason note">
            <input value={form.reasonText} onChange={update('reasonText')} />
          </Field>
          <button type="submit" disabled={busy}>Post reserve change</button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Panel>

      <Panel title="Reserve ledger">
        <DataTable
          columns={[
            { key: 'sequence', label: 'Seq', align: 'right' },
            { key: 'component', label: 'Component' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => money(row.amount, row.currency) },
            { key: 'reasonCode', label: 'Reason' },
            { key: 'effectiveDate', label: 'Effective' },
            { key: 'authority', label: 'Authority', render: (row) => row.authority || '—' },
            { key: 'current', label: 'Current', render: (row) => (row.current ? 'Yes' : 'No') }
          ]}
          rows={history}
          emptyText="No reserve history."
        />
      </Panel>
    </>
  );
}
