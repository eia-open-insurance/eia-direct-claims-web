import React, { useEffect, useState } from 'react';
import { api, today } from './api.js';
import { DataTable, ErrorText, Field, gridStyle, Panel } from './ui.jsx';

const EMPTY = {
  matterType: 'DEFENSE',
  jurisdiction: '',
  counselPartyId: '',
  filingDate: today(),
  trialDate: '',
  status: 'ACTIVE',
  caseNumber: ''
};

export default function LitigationTab({ claim }) {
  const [matters, setMatters] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setMatters(await api.litigation.list(claim.id));
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
      await api.litigation.create(claim.id, {
        matterType: form.matterType,
        jurisdiction: form.jurisdiction,
        counselPartyId: form.counselPartyId,
        filingDate: form.filingDate,
        trialDate: form.trialDate || null,
        status: form.status,
        caseNumber: form.caseNumber || null
      });
      setForm(EMPTY);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Litigation matters">
        <DataTable
          columns={[
            { key: 'matterType', label: 'Matter type' },
            { key: 'jurisdiction', label: 'Jurisdiction' },
            { key: 'caseNumber', label: 'Case number', render: (row) => row.caseNumber || '—' },
            { key: 'filingDate', label: 'Filed' },
            { key: 'trialDate', label: 'Trial', render: (row) => row.trialDate || '—' },
            { key: 'status', label: 'Status' }
          ]}
          rows={matters}
          emptyText="No litigation matter."
        />
      </Panel>

      <Panel title="Open a litigation matter">
        <form onSubmit={submit} style={gridStyle}>
          <Field label="Matter type">
            <select value={form.matterType} onChange={update('matterType')}>
              <option value="DEFENSE">Defense</option>
              <option value="COVERAGE">Coverage</option>
              <option value="APPEAL">Appeal</option>
              <option value="BANKRUPTCY">Bankruptcy</option>
              <option value="REGULATORY">Regulatory</option>
              <option value="TRANSACTIONAL">Transactional</option>
            </select>
          </Field>
          <Field label="Litigation jurisdiction">
            <input value={form.jurisdiction} onChange={update('jurisdiction')} required />
          </Field>
          <Field label="Counsel party ID">
            <input value={form.counselPartyId} onChange={update('counselPartyId')} required />
          </Field>
          <Field label="Filing date">
            <input type="date" value={form.filingDate} onChange={update('filingDate')} required />
          </Field>
          <Field label="Trial date">
            <input type="date" value={form.trialDate} onChange={update('trialDate')} min={form.filingDate} />
          </Field>
          <Field label="Litigation status">
            <select value={form.status} onChange={update('status')}>
              <option value="ACTIVE">Active</option>
              <option value="STAYED">Stayed</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="SETTLED">Settled</option>
              <option value="JUDGMENT">Judgment</option>
              <option value="ON_APPEAL">On appeal</option>
              <option value="CLOSED">Closed</option>
            </select>
          </Field>
          <Field label="Case number">
            <input value={form.caseNumber} onChange={update('caseNumber')} />
          </Field>
          <button type="submit" disabled={busy}>Open litigation matter</button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Panel>
    </>
  );
}
