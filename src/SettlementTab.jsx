import React, { useEffect, useState } from 'react';
import { api, money, RELEASE_DOCUMENT_ID, REVIEWER_ID } from './api.js';
import { DataTable, ErrorText, Field, Panel } from './ui.jsx';

const EMPTY = {
  amount: '',
  structure: 'LUMP_SUM',
  releaseScope: 'FULL',
  paymentInstructions: ''
};

export default function SettlementTab({ claim, onChanged }) {
  const [settlements, setSettlements] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setSettlements(await api.settlements.list(claim.id));
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
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function action(settlement, kind) {
    setBusy(true);
    setError('');
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
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Settlements">
        <DataTable
          columns={[
            { key: 'settlementNumber', label: 'Number' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => money(row.amount, row.currency) },
            { key: 'structure', label: 'Structure' },
            { key: 'status', label: 'Status' },
            { key: 'approvalAuthority', label: 'Authority', render: (row) => row.approvalAuthority || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <span style={{ display: 'inline-flex', gap: 6 }}>
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
                </span>
              )
            }
          ]}
          rows={settlements}
          emptyText="No settlement."
        />
      </Panel>

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
        <ErrorText>{error}</ErrorText>
      </Panel>
    </>
  );
}
