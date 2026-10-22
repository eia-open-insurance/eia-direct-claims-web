import React, { useEffect, useState } from 'react';
import { api, money, today } from './api.js';
import EntityPicker from './EntityPicker.jsx';
import { navigate } from './navigation.js';
import { partyLabel } from './related.jsx';
import { DataTable, ErrorText, Field, Panel, shortId } from './ui.jsx';

const EMPTY = {
  matterType: 'DEFENSE',
  jurisdiction: '',
  counselPartyId: '',
  counselPartyLabel: '',
  filingDate: today(),
  trialDate: '',
  status: 'ACTIVE',
  caseNumber: '',
  damagesSought: '',
  damagesCurrency: ''
};

/** ISO 4217 alpha-3; the form normalizes the entered code to upper case. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function counselIdOf(row) {
  return row?.counselPartyId ? String(row.counselPartyId) : '';
}

function counselHref(partyId) {
  return `/party?record=${encodeURIComponent(partyId)}`;
}

/** Damages are optional; an absent or blank amount means the pair was omitted. */
function damagesAmountOf(row) {
  const value = row?.damagesSought;
  return value === null || value === undefined || value === '' ? null : value;
}

function damagesCurrencyOf(row, fallbackCurrency) {
  return row?.damagesCurrency || fallbackCurrency || 'USD';
}

/**
 * The damages pair is all-or-nothing. The server remains authoritative, but the
 * form catches the common mistakes (half a pair, zero/negative amount, code that
 * is not alpha-3) before posting.
 */
function damagesPairError(form) {
  const amount = String(form.damagesSought ?? '').trim();
  const currency = String(form.damagesCurrency ?? '').trim().toUpperCase();
  if (!amount && !currency) return '';
  if (!amount) {
    return 'Enter the damages sought amount when a damages currency is selected.';
  }
  if (!currency) {
    return 'Enter the damages sought currency when a damages amount is entered.';
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'Damages sought amount must be a positive number.';
  }
  if (!CURRENCY_PATTERN.test(currency)) {
    return 'Damages sought currency must be a three-letter ISO 4217 code.';
  }
  return '';
}

export default function LitigationTab({ claim }) {
  const [matters, setMatters] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [counselLabels, setCounselLabels] = useState({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const rows = await api.litigation.list(claim.id);
    setMatters(Array.isArray(rows) ? rows : []);
  }

  useEffect(() => {
    setError('');
    setFormError('');
    setCounselLabels({});
    load().catch((cause) => setError(cause.message));
  }, [claim.id]);

  /**
   * A persisted matter stores only the counsel party id. Resolve the shared
   * party label so the table can link to the party record by name; a failed
   * lookup keeps the id fallback and never blocks the litigation list.
   */
  useEffect(() => {
    const rows = Array.isArray(matters) ? matters : [];
    const ids = [
      ...new Set(
        rows
          .filter((row) => counselIdOf(row) && !row.counselPartyLabel)
          .map((row) => counselIdOf(row))
      )
    ];
    if (ids.length === 0) return undefined;

    let alive = true;
    Promise.all(
      ids.map(async (partyId) => {
        try {
          const detail = await api.parties.get(partyId);
          return [partyId, partyLabel(detail)];
        } catch {
          return [partyId, ''];
        }
      })
    ).then((entries) => {
      if (!alive) return;
      setCounselLabels((current) => {
        const next = { ...current };
        entries.forEach(([partyId, label]) => {
          if (label) next[partyId] = label;
        });
        return next;
      });
    });

    return () => {
      alive = false;
    };
  }, [matters]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function updateCurrency(event) {
    const currency = event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    setForm((current) => ({ ...current, damagesCurrency: currency }));
  }

  /** Keeps the selected party id and its picker label together. */
  function selectCounsel(partyId, item) {
    setForm((current) => ({
      ...current,
      counselPartyId: partyId || '',
      counselPartyLabel: partyId ? item?.label || '' : ''
    }));
    setFormError('');
  }

  function validate() {
    if (!form.counselPartyId) {
      return 'Select the counsel party from the shared party records.';
    }
    if (!form.jurisdiction.trim()) {
      return 'Enter the litigation jurisdiction.';
    }
    if (!form.filingDate) {
      return 'Choose the filing date.';
    }
    if (form.trialDate && form.trialDate < form.filingDate) {
      return 'Trial date must be on or after the filing date.';
    }
    return damagesPairError(form);
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
    let created = false;
    try {
      const damagesAmount = String(form.damagesSought ?? '').trim();
      const damagesCurrency = String(form.damagesCurrency ?? '').trim().toUpperCase();
      const payload = {
        matterType: form.matterType,
        jurisdiction: form.jurisdiction.trim(),
        counselPartyId: form.counselPartyId,
        filingDate: form.filingDate,
        trialDate: form.trialDate || null,
        status: form.status,
        caseNumber: form.caseNumber.trim() || null
      };
      // Optional pair: omit both members when neither was entered so the API
      // records "no pleaded amount" rather than a zero or a stray currency.
      if (damagesAmount) {
        payload.damagesSought = damagesAmount;
        payload.damagesCurrency = damagesCurrency;
      }

      if (form.counselPartyId && form.counselPartyLabel) {
        setCounselLabels((current) => ({
          ...current,
          [form.counselPartyId]: form.counselPartyLabel
        }));
      }

      await api.litigation.create(claim.id, payload);
      created = true;
      setForm(EMPTY);
    } catch (cause) {
      setFormError(cause.message);
    } finally {
      setBusy(false);
    }

    // A refresh failure must not read as a rejected create: the matter is
    // already recorded, so the ledger error is shown beside the table.
    if (created) {
      try {
        await load();
      } catch (cause) {
        setError(cause.message);
      }
    }
  }

  const damagesAmount = String(form.damagesSought ?? '').trim();
  const damagesCurrency = String(form.damagesCurrency ?? '').trim().toUpperCase();
  const damagesNumeric = Number(damagesAmount);
  const damagesPreview =
    damagesAmount &&
    damagesCurrency &&
    Number.isFinite(damagesNumeric) &&
    damagesNumeric > 0
      ? `Pleaded ${money(damagesAmount, damagesCurrency)}.`
      : '';

  function counselLabelFor(row) {
    const partyId = counselIdOf(row);
    if (!partyId) return '';
    return row.counselPartyLabel || counselLabels[partyId] || shortId(partyId);
  }

  return (
    <>
      <Panel title="Litigation matters">
        <DataTable
          columns={[
            { key: 'matterType', label: 'Matter type' },
            { key: 'jurisdiction', label: 'Jurisdiction' },
            {
              key: 'counselPartyId',
              label: 'Counsel',
              render: (row) => {
                const partyId = counselIdOf(row);
                if (!partyId) return '—';
                return (
                  <a
                    href={counselHref(partyId)}
                    onClick={openRecord}
                    data-testid={`litigation-counsel-${row.id || partyId}`}
                    title="Open counsel party record"
                  >
                    {counselLabelFor(row)}
                  </a>
                );
              }
            },
            { key: 'caseNumber', label: 'Case number', render: (row) => row.caseNumber || '—' },
            { key: 'filingDate', label: 'Filed' },
            { key: 'trialDate', label: 'Trial', render: (row) => row.trialDate || '—' },
            { key: 'status', label: 'Status' },
            {
              key: 'damagesSought',
              label: 'Damages sought',
              align: 'right',
              render: (row) => {
                const amount = damagesAmountOf(row);
                const currency = damagesCurrencyOf(row, claim.reserveCurrency);
                return (
                  <span
                    data-testid={`litigation-damages-${row.id || amount || 'none'}`}
                    title={amount == null ? 'No pleaded damages recorded' : `Pleaded damages ${money(amount, currency)}`}
                  >
                    {amount == null ? '—' : money(amount, currency)}
                  </span>
                );
              }
            }
          ]}
          rows={matters}
          emptyText="No litigation matter."
        />
        <p className="eia-muted" data-testid="litigation-damages-note" style={{ margin: '10px 0 0' }}>
          Damages sought is the amount pleaded in the matter, recorded with its own currency. It is
          not the claim reserve, the settlement authority, or a payment.
        </p>
        {error && (
          <div data-testid="litigation-load-error">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </Panel>

      <Panel title="Open a litigation matter">
        <form onSubmit={submit} className="eia-form-grid" noValidate>
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
          <Field label="Counsel party">
            <EntityPicker
              endpoint="/api/v1/parties/search"
              value={form.counselPartyId}
              valueLabel={form.counselPartyLabel}
              onChange={selectCounsel}
              placeholder="Search counsel party number or name…"
              disabled={busy}
            />
            {form.counselPartyId && (
              <span className="eia-picker-hint" data-testid="litigation-counsel-selection">
                Selected counsel party:{' '}
                <a
                  href={counselHref(form.counselPartyId)}
                  onClick={openRecord}
                  data-testid="litigation-counsel-link"
                  title="Open counsel party record"
                >
                  {form.counselPartyLabel || shortId(form.counselPartyId)}
                </a>
              </span>
            )}
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
          <Field label="Damages sought amount">
            <input
              id="litigationDamagesAmount"
              type="number"
              step="0.01"
              value={form.damagesSought}
              onChange={update('damagesSought')}
              placeholder="Optional pleaded amount"
              aria-label="Damages sought amount"
              aria-describedby="litigation-damages-detail"
            />
          </Field>
          <Field label="Damages sought currency">
            <input
              id="litigationDamagesCurrency"
              value={form.damagesCurrency}
              onChange={updateCurrency}
              maxLength={3}
              placeholder={claim.reserveCurrency || 'USD'}
              aria-label="Damages sought currency"
              aria-describedby="litigation-damages-detail"
            />
            <span
              id="litigation-damages-detail"
              className="eia-picker-hint"
              data-testid="litigation-damages-detail"
            >
              Optional. Enter the pleaded amount and its ISO 4217 currency together, or leave both
              blank.{damagesPreview ? ` ${damagesPreview}` : ''}
            </span>
          </Field>
          <button type="submit" disabled={busy}>Open litigation matter</button>
        </form>
        {formError && (
          <div data-testid="litigation-form-error">
            <ErrorText>{formError}</ErrorText>
          </div>
        )}
      </Panel>

      <section
        className="eia-context-panel"
        aria-label="Litigation context"
        data-testid="litigation-context"
      >
        <h4>Litigation context</h4>
        <p>
          <b>Counsel is a party record.</b> The counsel on a matter is chosen from the shared party
          master data. The matter stores the party id and links to that party record, so the party
          name and number stay owned by the party record instead of being copied onto the matter.
        </p>
        <p>
          <b>Damages sought is the pleaded amount.</b> It is the amount the claimant pleads in the
          litigation, recorded together with its own ISO 4217 currency. It is not the claim
          reserve, the settlement authority, or a payment; those amounts are separate from the
          pleaded damages.
        </p>
        <p>
          <b>Reserves and authority are separate.</b> Recording a matter, its counsel, or the
          pleaded damages does not change the claim reserve, coverage position, settlement
          authority, settlements, or payments.
        </p>
      </section>
    </>
  );
}
