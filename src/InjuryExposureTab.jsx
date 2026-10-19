import React, { useEffect, useState } from 'react';
import { api, today } from './api.js';
import { DataTable, ErrorText, Field, gridStyle, Panel } from './ui.jsx';

const EMPTY_INJURY = {
  injuryType: 'MESOTHELIOMA',
  bodyPart: '',
  diagnosisCodes: '',
  severity: 'SEVERE',
  diagnosisDate: ''
};

const EMPTY_EXPOSURE = {
  exposureType: 'SUBSTANCE',
  substanceName: '',
  siteName: '',
  jurisdiction: '',
  exposureFrom: '',
  exposureTo: '',
  intensity: 'HIGH'
};

export default function InjuryExposureTab({ claim }) {
  const [injuries, setInjuries] = useState([]);
  const [exposures, setExposures] = useState([]);
  const [injuryForm, setInjuryForm] = useState(EMPTY_INJURY);
  const [exposureForm, setExposureForm] = useState(EMPTY_EXPOSURE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [injuryRows, exposureRows] = await Promise.all([
      api.injuries.list(claim.id),
      api.exposures.list(claim.id)
    ]);
    setInjuries(injuryRows);
    setExposures(exposureRows);
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [claim.id]);

  function update(setter, field) {
    return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submitInjury(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.injuries.create(claim.id, {
        claimantPartyId: claim.claimantPartyId,
        injuryType: injuryForm.injuryType,
        bodyPart: injuryForm.bodyPart || null,
        diagnosisCodes: injuryForm.diagnosisCodes
          ? injuryForm.diagnosisCodes.split(',').map((code) => code.trim()).filter(Boolean)
          : [],
        severity: injuryForm.severity,
        diagnosisDate: injuryForm.diagnosisDate || null,
        expectedVersion: null
      });
      setInjuryForm(EMPTY_INJURY);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitExposure(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.exposures.create(claim.id, {
        claimantPartyId: claim.claimantPartyId,
        exposureType: exposureForm.exposureType,
        substanceName: exposureForm.substanceName || null,
        siteName: exposureForm.siteName || null,
        jurisdiction: exposureForm.jurisdiction,
        exposureFrom: exposureForm.exposureFrom,
        exposureTo: exposureForm.exposureTo || null,
        intensity: exposureForm.intensity
      });
      setExposureForm(EMPTY_EXPOSURE);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Injuries">
        <DataTable
          columns={[
            { key: 'injuryType', label: 'Injury type' },
            { key: 'bodyPart', label: 'Body part', render: (row) => row.bodyPart || '—' },
            { key: 'severity', label: 'Severity' },
            {
              key: 'diagnosisCodes',
              label: 'Diagnosis codes',
              render: (row) => (row.diagnosisCodes?.length ? row.diagnosisCodes.join(', ') : '—')
            },
            { key: 'version', label: 'Version', align: 'right' }
          ]}
          rows={injuries}
          emptyText="No injury recorded."
        />
        <form onSubmit={submitInjury} style={{ ...gridStyle, marginTop: 16 }}>
          <Field label="Injury type">
            <select value={injuryForm.injuryType} onChange={update(setInjuryForm, 'injuryType')}>
              <option value="MESOTHELIOMA">Mesothelioma</option>
              <option value="LUNG_CANCER">Lung cancer</option>
              <option value="ASBESTOSIS">Asbestosis</option>
              <option value="PLEURAL_DISEASE">Pleural disease</option>
              <option value="RESPIRATORY_INJURY">Respiratory injury</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Body part">
            <input value={injuryForm.bodyPart} onChange={update(setInjuryForm, 'bodyPart')} />
          </Field>
          <Field label="Diagnosis codes">
            <input
              value={injuryForm.diagnosisCodes}
              onChange={update(setInjuryForm, 'diagnosisCodes')}
              placeholder="C45.0, C45.9"
            />
          </Field>
          <Field label="Injury severity">
            <select value={injuryForm.severity} onChange={update(setInjuryForm, 'severity')}>
              <option value="MILD">Mild</option>
              <option value="MODERATE">Moderate</option>
              <option value="SEVERE">Severe</option>
              <option value="CATASTROPHIC">Catastrophic</option>
              <option value="FATAL">Fatal</option>
            </select>
          </Field>
          <Field label="Diagnosis date">
            <input
              type="date"
              value={injuryForm.diagnosisDate}
              onChange={update(setInjuryForm, 'diagnosisDate')}
              max={today()}
            />
          </Field>
          <button type="submit" disabled={busy}>Record injury</button>
        </form>
      </Panel>

      <Panel title="Exposures">
        <DataTable
          columns={[
            { key: 'exposureType', label: 'Exposure type' },
            { key: 'substanceName', label: 'Substance / product', render: (row) => row.substanceName || row.productName || '—' },
            { key: 'jurisdiction', label: 'Jurisdiction' },
            { key: 'exposureFrom', label: 'From' },
            { key: 'exposureTo', label: 'To', render: (row) => row.exposureTo || '—' },
            { key: 'intensity', label: 'Intensity' }
          ]}
          rows={exposures}
          emptyText="No exposure recorded."
        />
        <form onSubmit={submitExposure} style={{ ...gridStyle, marginTop: 16 }}>
          <Field label="Exposure type">
            <select value={exposureForm.exposureType} onChange={update(setExposureForm, 'exposureType')}>
              <option value="SUBSTANCE">Substance</option>
              <option value="PRODUCT">Product</option>
              <option value="SITE">Site</option>
              <option value="OCCUPATION">Occupation</option>
              <option value="ENVIRONMENT">Environment</option>
              <option value="MEDICAL_DEVICE">Medical device</option>
            </select>
          </Field>
          <Field label="Substance name">
            <input value={exposureForm.substanceName} onChange={update(setExposureForm, 'substanceName')} />
          </Field>
          <Field label="Site name">
            <input value={exposureForm.siteName} onChange={update(setExposureForm, 'siteName')} />
          </Field>
          <Field label="Jurisdiction">
            <input
              value={exposureForm.jurisdiction}
              onChange={update(setExposureForm, 'jurisdiction')}
              placeholder="US-OH"
            />
          </Field>
          <Field label="Exposure from">
            <input
              type="date"
              value={exposureForm.exposureFrom}
              onChange={update(setExposureForm, 'exposureFrom')}
              required
            />
          </Field>
          <Field label="Exposure to">
            <input
              type="date"
              value={exposureForm.exposureTo}
              onChange={update(setExposureForm, 'exposureTo')}
              max={claim.reportDate}
            />
          </Field>
          <Field label="Exposure intensity">
            <select value={exposureForm.intensity} onChange={update(setExposureForm, 'intensity')}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="EXTREME">Extreme</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </Field>
          <button type="submit" disabled={busy}>Record exposure</button>
        </form>
      </Panel>

      <ErrorText>{error}</ErrorText>
    </>
  );
}
