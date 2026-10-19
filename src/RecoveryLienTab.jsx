import React, { useEffect, useState } from 'react';
import { api, money, today } from './api.js';
import { DataTable, ErrorText, Field, gridStyle, Panel } from './ui.jsx';

const EMPTY_RECOVERY = {
  recoveryType: 'SUBROGATION',
  amount: '',
  source: '',
  status: 'PURSUING',
  recoveryDate: ''
};

const EMPTY_LIEN = {
  lienType: 'MEDICARE',
  lienholder: '',
  amount: '',
  status: 'IDENTIFIED',
  resolutionType: 'NEGOTIATED'
};

const TERMINAL = ['RESOLVED', 'WAIVED', 'PAID'];

export default function RecoveryLienTab({ claim }) {
  const [recoveries, setRecoveries] = useState([]);
  const [liens, setLiens] = useState([]);
  const [recoveryForm, setRecoveryForm] = useState(EMPTY_RECOVERY);
  const [lienForm, setLienForm] = useState(EMPTY_LIEN);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [recoveryRows, lienRows] = await Promise.all([
      api.recoveries.list(claim.id),
      api.liens.list(claim.id)
    ]);
    setRecoveries(recoveryRows);
    setLiens(lienRows);
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [claim.id]);

  function update(setter, field) {
    return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submitRecovery(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.recoveries.create(claim.id, {
        recoveryType: recoveryForm.recoveryType,
        amount: recoveryForm.amount,
        currency: claim.reserveCurrency || 'USD',
        source: recoveryForm.source,
        status: recoveryForm.status,
        recoveryDate: recoveryForm.recoveryDate || null
      });
      setRecoveryForm(EMPTY_RECOVERY);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitLien(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const terminal = TERMINAL.includes(lienForm.status);
      await api.liens.create(claim.id, {
        lienType: lienForm.lienType,
        lienholder: lienForm.lienholder,
        amount: lienForm.amount,
        currency: claim.reserveCurrency || 'USD',
        status: lienForm.status,
        resolutionType: terminal ? lienForm.resolutionType : null
      });
      setLienForm(EMPTY_LIEN);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveLien(lien) {
    setBusy(true);
    setError('');
    try {
      await api.liens.update(claim.id, lien.id, {
        status: 'RESOLVED',
        resolutionType: 'NEGOTIATED',
        expectedVersion: lien.version
      });
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function markReceived(recovery) {
    setBusy(true);
    setError('');
    try {
      await api.recoveries.update(claim.id, recovery.id, {
        status: 'RECEIVED',
        recoveryDate: recovery.recoveryDate || today(),
        expectedVersion: recovery.version
      });
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Recoveries">
        <DataTable
          columns={[
            { key: 'recoveryType', label: 'Type' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => money(row.amount, row.currency) },
            { key: 'source', label: 'Source' },
            { key: 'status', label: 'Status' },
            { key: 'recoveryDate', label: 'Received', render: (row) => row.recoveryDate || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <button
                  type="button"
                  disabled={busy || row.status === 'RECEIVED'}
                  onClick={() => markReceived(row)}
                >
                  {`Mark received ${row.id.slice(0, 8)}`}
                </button>
              )
            }
          ]}
          rows={recoveries}
          emptyText="No recovery."
        />
        <form onSubmit={submitRecovery} style={{ ...gridStyle, marginTop: 16 }}>
          <Field label="Recovery type">
            <select value={recoveryForm.recoveryType} onChange={update(setRecoveryForm, 'recoveryType')}>
              <option value="SUBROGATION">Subrogation</option>
              <option value="SALVAGE">Salvage</option>
              <option value="CONTRIBUTION">Contribution</option>
              <option value="OTHER_INSURANCE">Other insurance</option>
              <option value="GOVERNMENT">Government</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Recovery amount">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={recoveryForm.amount}
              onChange={update(setRecoveryForm, 'amount')}
              required
            />
          </Field>
          <Field label="Recovery source">
            <input value={recoveryForm.source} onChange={update(setRecoveryForm, 'source')} required />
          </Field>
          <Field label="Recovery status">
            <select
              value={recoveryForm.status}
              onChange={(event) => {
                const status = event.target.value;
                setRecoveryForm((current) => ({
                  ...current,
                  status,
                  recoveryDate: status === 'RECEIVED' ? current.recoveryDate || today() : current.recoveryDate
                }));
              }}
            >
              <option value="PURSUING">Pursuing</option>
              <option value="AGREED">Agreed</option>
              <option value="RECEIVED">Received</option>
              <option value="DENIED">Denied</option>
              <option value="ABANDONED">Abandoned</option>
            </select>
          </Field>
          <Field label="Recovery date">
            <input
              type="date"
              value={recoveryForm.recoveryDate}
              onChange={update(setRecoveryForm, 'recoveryDate')}
            />
          </Field>
          <button type="submit" disabled={busy}>Record recovery</button>
        </form>
      </Panel>

      <Panel title="Liens">
        <DataTable
          columns={[
            { key: 'lienType', label: 'Type' },
            { key: 'lienholder', label: 'Lienholder' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => money(row.amount, row.currency) },
            { key: 'status', label: 'Status' },
            { key: 'resolutionType', label: 'Resolution', render: (row) => row.resolutionType || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <button
                  type="button"
                  disabled={busy || TERMINAL.includes(row.status)}
                  onClick={() => resolveLien(row)}
                >
                  {`Resolve lien ${row.id.slice(0, 8)}`}
                </button>
              )
            }
          ]}
          rows={liens}
          emptyText="No lien."
        />
        <form onSubmit={submitLien} style={{ ...gridStyle, marginTop: 16 }}>
          <Field label="Lien type">
            <select value={lienForm.lienType} onChange={update(setLienForm, 'lienType')}>
              <option value="MEDICARE">Medicare</option>
              <option value="MEDICAID">Medicaid</option>
              <option value="WORKERS_COMPENSATION">Workers compensation</option>
              <option value="HOSPITAL">Hospital</option>
              <option value="PHYSICIAN">Physician</option>
              <option value="ERISA">ERISA</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Lienholder">
            <input value={lienForm.lienholder} onChange={update(setLienForm, 'lienholder')} required />
          </Field>
          <Field label="Lien amount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={lienForm.amount}
              onChange={update(setLienForm, 'amount')}
              required
            />
          </Field>
          <Field label="Lien status">
            <select value={lienForm.status} onChange={update(setLienForm, 'status')}>
              <option value="IDENTIFIED">Identified</option>
              <option value="VERIFIED">Verified</option>
              <option value="NEGOTIATING">Negotiating</option>
              <option value="DISPUTED">Disputed</option>
              <option value="RESOLVED">Resolved</option>
              <option value="WAIVED">Waived</option>
              <option value="PAID">Paid</option>
            </select>
          </Field>
          <Field label="Lien resolution">
            <select value={lienForm.resolutionType} onChange={update(setLienForm, 'resolutionType')}>
              <option value="PAID">Paid</option>
              <option value="NEGOTIATED">Negotiated</option>
              <option value="WAIVED">Waived</option>
              <option value="DEFERRED">Deferred</option>
            </select>
          </Field>
          <button type="submit" disabled={busy}>Record lien</button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Panel>
    </>
  );
}
