import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import './ui-overrides.css';
import { api, BOOK, money } from './api.js';
import ActivityTab from './ActivityTab.jsx';
import AllocationsTab from './AllocationsTab.jsx';
import AssignmentDialog, {
  assignmentFilterValues,
  assignmentText,
  readAssignment
} from './ClaimAssignment.jsx';
import ClaimProgress, { EMPTY_PROCESS } from './ClaimProgress.jsx';
import EntityPicker from './EntityPicker.jsx';
import CoverageTab from './CoverageTab.jsx';
import DiaryNotesTab from './DiaryNotesTab.jsx';
import { loadDirectory } from './directory.js';
import InjuryExposureTab from './InjuryExposureTab.jsx';
import LitigationTab from './LitigationTab.jsx';
import { navigate, recordHref } from './navigation.js';
import OverviewTab from './OverviewTab.jsx';
import { RelatedLabel, useRelatedLabels } from './related.jsx';
import RecoveryLienTab from './RecoveryLienTab.jsx';
import ReserveTab from './ReserveTab.jsx';
import SettlementTab from './SettlementTab.jsx';
import { ErrorText, Field, humanize, shortId, statusTone } from './ui.jsx';

const EMPTY_FORM = {
  policyId: '',
  policyLabel: '',
  policySecondary: '',
  claimantPartyId: '',
  claimantLabel: '',
  claimantSecondary: '',
  lossDate: '',
  reportDate: '',
  causeCode: '',
  claimType: 'BODILY_INJURY',
  reserveAmount: '0.00',
  reserveCurrency: 'USD',
  settlementAuthorityAmount: ''
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'injuries', label: 'Injuries & Exposures' },
  { id: 'reserves', label: 'Reserve History' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'allocations', label: 'Allocations' },
  { id: 'litigation', label: 'Litigation' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'recovery', label: 'Recovery & Liens' },
  { id: 'diary', label: 'Diary & Notes' },
  { id: 'activity', label: 'Activity' }
];

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
  width: 'min(880px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sumBy(rows, statuses) {
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((row) => statuses.includes(row.status))
    .reduce((total, row) => total + (Number(row.amount) || 0), 0);
}

/** Open diary items exclude completed and cancelled tasks. */
function countOpenTasks(rows) {
  if (!Array.isArray(rows)) return null;
  const closed = ['COMPLETE', 'CANCELLED'];
  return rows.filter((row) => !closed.includes(String(row.status || 'OPEN').toUpperCase())).length;
}

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false };
  const params = new URLSearchParams(window.location.search);
  return { record: params.get('record') || '', create: params.get('new') === '1' };
}

/**
 * The remote is mounted either at the shell route (/direct-claims) or directly
 * at the dev-server root (/). Only treat the URL as claims state on those routes
 * so a cross-link to /policy or /party does not get interpreted as a claim id.
 */
function onClaimsRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/' || path.endsWith('/direct-claims');
}

function writeUrl({ record = '', create = false, replace = false } = {}) {
  if (typeof window === 'undefined' || !onClaimsRoute()) return;
  const params = new URLSearchParams();
  if (record) params.set('record', record);
  if (create) params.set('new', '1');
  const query = params.toString();
  const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (target === current) return;
  try {
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
  } catch {
    // URL state is an enhancement; queue selection still works without it.
  }
}

function openRecord(event) {
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

function filterClaims(claims, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return claims;
  return claims.filter((claim) =>
    [
      claim.claimNumber,
      claim.claimType,
      humanize(claim.claimType),
      claim.causeCode,
      claim.status,
      ...assignmentFilterValues(claim)
    ].some((value) => String(value || '').toLowerCase().includes(term))
  );
}

export default function App() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [summary, setSummary] = useState({ paidLoss: null, recoveries: null, openTasks: null });
  const [processData, setProcessData] = useState(EMPTY_PROCESS);
  const [summaryNonce, setSummaryNonce] = useState(0);
  const [queueFilter, setQueueFilter] = useState('');
  const [directoryState, setDirectoryState] = useState({ status: 'loading', data: null });

  const claimsRef = useRef([]);
  const applyingUrlRef = useRef(false);
  const registerOpenRef = useRef(false);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;
  const selectedClaimId = selectedClaim?.id || null;
  const currency = selectedClaim?.reserveCurrency || 'USD';
  const filteredClaims = filterClaims(claims, queueFilter);
  const selectedAssignment = assignmentText(selectedClaim);
  const related = useRelatedLabels(selectedClaim);

  useEffect(() => {
    registerOpenRef.current = registerOpen;
  }, [registerOpen]);

  async function load() {
    const rows = await api.claims.list();
    setClaims(Array.isArray(rows) ? rows : []);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Applies ?record= and ?new=1. The record is selected immediately when it is
   * already in the queue; otherwise the detail endpoint is fetched and the claim
   * is inserted at the top of the queue.
   */
  async function applyUrlState(rows, { initial = false } = {}) {
    if (!onClaimsRoute()) return;
    const { record, create } = readUrlState();

    if (create) {
      if (!registerOpenRef.current) setForm(EMPTY_FORM);
      setRegisterOpen(true);
      setError('');
      return;
    }

    if (!record) {
      if (!initial) {
        setRegisterOpen(false);
        setError('');
      }
      return;
    }

    setRegisterOpen(false);
    if (applyingUrlRef.current) return;

    const queue = Array.isArray(rows) && rows.length > 0 ? rows : claimsRef.current;
    const known = queue.find((claim) => claim.id === record || claim.claimNumber === record);
    if (known) {
      setSelectedId(known.id);
      setError('');
      return;
    }

    if (!UUID_PATTERN.test(record)) {
      setError(`Claim “${record}” was not found in the DIRECT claim queue.`);
      return;
    }

    applyingUrlRef.current = true;
    try {
      const claim = await api.claims.get(record);
      if (claim?.id) {
        setClaims((current) => (current.some((row) => row.id === claim.id) ? current : [claim, ...current]));
        setSelectedId(claim.id);
        setActiveTab('overview');
        setError('');
      }
    } catch (cause) {
      setError(`Claim ${record} could not be loaded: ${cause.message}`);
      setSelectedId((current) => current || claimsRef.current[0]?.id || null);
    } finally {
      applyingUrlRef.current = false;
    }
  }

  useEffect(() => {
    let alive = true;
    if (readUrlState().create && onClaimsRoute()) {
      setForm(EMPTY_FORM);
      setRegisterOpen(true);
    }

    const onPopState = () => {
      applyUrlState(claimsRef.current);
    };
    window.addEventListener('popstate', onPopState);

    load()
      .then((rows) => {
        if (!alive) return;
        setLoading(false);
        applyUrlState(rows, { initial: true });
      })
      .catch((cause) => {
        if (!alive) return;
        setLoading(false);
        setError(cause.message);
      });

    return () => {
      alive = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  /**
   * The people/team directory is loaded once for the whole app session. It is
   * shared master data, so it is neither tenant- nor book-scoped, and a failure
   * is deliberately non-blocking: the assignment dialog falls back to manual
   * ownership entry and the standard team list.
   */
  useEffect(() => {
    let alive = true;
    loadDirectory()
      .then((data) => {
        if (alive) setDirectoryState({ status: 'ready', data });
      })
      .catch(() => {
        if (alive) setDirectoryState({ status: 'error', data: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    claimsRef.current = claims;
    setSelectedId((current) => {
      if (current && claims.some((claim) => claim.id === current)) return current;
      const requested = readUrlState().record;
      if (requested && !claims.some((claim) => claim.id === requested || claim.claimNumber === requested)) {
        // Keep waiting for the detail lookup instead of selecting a different claim.
        return current;
      }
      return claims[0]?.id || null;
    });
  }, [claims]);

  useEffect(() => {
    let alive = true;
    if (!selectedClaimId) {
      setSummary({ paidLoss: null, recoveries: null, openTasks: null });
      setProcessData(EMPTY_PROCESS);
      return undefined;
    }

    setSummary({ paidLoss: null, recoveries: null, openTasks: null });
    setProcessData(EMPTY_PROCESS);
    Promise.allSettled([
      api.coverage.get(selectedClaimId),
      api.reserves.get(selectedClaimId),
      api.litigation.list(selectedClaimId),
      api.settlements.list(selectedClaimId),
      api.recoveries.list(selectedClaimId),
      api.tasks.list(selectedClaimId)
    ]).then(
      ([
        coverageResult,
        reservesResult,
        litigationResult,
        settlementsResult,
        recoveriesResult,
        tasksResult
      ]) => {
        if (!alive) return;
        const coverage = coverageResult.status === 'fulfilled' ? coverageResult.value : null;
        const reserves = reservesResult.status === 'fulfilled' ? reservesResult.value : null;
        const litigation = litigationResult.status === 'fulfilled' ? litigationResult.value : null;
        const settlements = settlementsResult.status === 'fulfilled' ? settlementsResult.value : null;
        const recoveries = recoveriesResult.status === 'fulfilled' ? recoveriesResult.value : null;
        const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : null;
        setProcessData({
          coverage,
          reserves,
          litigation: Array.isArray(litigation) ? litigation : [],
          settlements: Array.isArray(settlements) ? settlements : [],
          recoveries: Array.isArray(recoveries) ? recoveries : []
        });
        setSummary({
          paidLoss: sumBy(settlements, ['EXECUTED', 'PAID']),
          recoveries: sumBy(recoveries, ['RECEIVED']),
          openTasks: countOpenTasks(tasks)
        });
      }
    );

    return () => {
      alive = false;
    };
  }, [selectedClaimId, summaryNonce]);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !registerBusy) {
        setRegisterOpen(false);
        setError('');
        writeUrl({ record: selectedId || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registerOpen, registerBusy, selectedId]);

  function refreshSummary() {
    setSummaryNonce((value) => value + 1);
  }

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function selectPolicy(id, item) {
    setForm((current) => ({
      ...current,
      policyId: id,
      policyLabel: item?.label || '',
      policySecondary: item?.secondary || ''
    }));
  }

  function selectClaimantParty(id, item) {
    setForm((current) => ({
      ...current,
      claimantPartyId: id,
      claimantLabel: item?.label || '',
      claimantSecondary: item?.secondary || ''
    }));
  }

  async function refresh() {
    setError('');
    try {
      await load();
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function handleRecordChanged() {
    refreshSummary();
    try {
      await load();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function upsertClaim(next) {
    if (!next?.id) return;
    setClaims((current) => {
      const index = current.findIndex((row) => row.id === next.id);
      if (index < 0) return [next, ...current];
      const copy = current.slice();
      copy[index] = { ...current[index], ...next };
      return copy;
    });
  }

  async function handleAssigned(updated, submitted) {
    const claimId = selectedClaim?.id;
    const claimNumber = selectedClaim?.claimNumber;
    if (!claimId) return;

    setAssignOpen(false);
    setError('');
    setNotice(`${claimNumber || 'Claim'} assigned to ${assignmentText(submitted).display}.`);

    // Show the server answer immediately, then reconcile with the refreshed
    // claim detail and queue list.
    const serverAssignment = readAssignment(updated);
    setClaims((current) =>
      current.map((row) => {
        if (row.id !== claimId) return row;
        return {
          ...row,
          ...(updated?.id === claimId ? updated : {}),
          assignedAdjuster: serverAssignment.assignedAdjuster || submitted.assignedAdjuster,
          assignedTeam: serverAssignment.assignedTeam || submitted.assignedTeam
        };
      })
    );
    refreshSummary();

    // Refresh both sources independently so a list failure cannot hide the
    // refreshed assignment detail (or the other way around).
    const [listResult, detailResult] = await Promise.allSettled([
      load(),
      api.claims.get(claimId)
    ]);
    if (detailResult.status === 'fulfilled' && detailResult.value?.id) {
      upsertClaim(detailResult.value);
    }
    const failure =
      listResult.status === 'rejected'
        ? listResult.reason
        : detailResult.status === 'rejected'
          ? detailResult.reason
          : null;
    if (failure) {
      setNotice(`Assignment saved. Refresh the claim to load the latest owner and audit entry.`);
    }
  }

  /** Loads the queue and detail again so a stale dialog can retry. */
  async function reloadClaimRecord(claimId) {
    const [listResult, detailResult] = await Promise.allSettled([
      load(),
      api.claims.get(claimId)
    ]);
    const rows = listResult.status === 'fulfilled' ? listResult.value : [];
    const fresh = detailResult.status === 'fulfilled' ? detailResult.value : null;
    const fallback = Array.isArray(rows) ? rows.find((row) => row.id === claimId) : null;
    const resolved = fresh?.id ? fresh : fallback;
    if (resolved) upsertClaim(resolved);
    refreshSummary();
    if (!resolved && listResult.status === 'rejected' && detailResult.status === 'rejected') {
      throw listResult.reason;
    }
    return resolved;
  }

  function openAssignment() {
    if (!selectedClaim) return;
    setError('');
    setNotice('');
    setAssignOpen(true);
  }

  function closeAssignment() {
    setAssignOpen(false);
  }

  function selectClaim(claim) {
    if (claim.id !== selectedId) setActiveTab('overview');
    setAssignOpen(false);
    setSelectedId(claim.id);
    setError('');
    setNotice('');
    writeUrl({ record: claim.id });
  }

  function openRegister() {
    setForm(EMPTY_FORM);
    setError('');
    setNotice('');
    setRegisterOpen(true);
    writeUrl({ create: true });
  }

  function closeRegister() {
    if (registerBusy) return;
    setRegisterOpen(false);
    setError('');
    writeUrl({ record: selectedId || '' });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.policyId || !form.claimantPartyId) {
      setError('Select a policy and a claimant party before registering the claim.');
      return;
    }

    setRegisterBusy(true);
    try {
      const payload = {
        policyId: form.policyId,
        claimantPartyId: form.claimantPartyId,
        lossDate: form.lossDate,
        reportDate: form.reportDate,
        causeCode: form.causeCode,
        claimType: form.claimType,
        reserveAmount: Number(form.reserveAmount || 0),
        reserveCurrency: form.reserveCurrency
      };
      if (form.settlementAuthorityAmount !== '') {
        payload.settlementAuthorityAmount = form.settlementAuthorityAmount;
        payload.settlementAuthorityCurrency = form.reserveCurrency;
      }
      const created = await api.claims.create(payload);
      setForm(EMPTY_FORM);
      setRegisterOpen(false);
      await load();
      if (created?.id) {
        setSelectedId(created.id);
        writeUrl({ record: created.id });
      }
      setActiveTab('overview');
      setNotice(
        created?.claimNumber
          ? `Claim ${created.claimNumber} registered on the DIRECT book.`
          : 'Claim registered on the DIRECT book.'
      );
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setRegisterBusy(false);
    }
  }

  async function closeClaim() {
    if (!selectedClaim || selectedClaim.status === 'CLOSED') return;
    const confirmed = window.confirm(
      `Close ${selectedClaim.claimNumber}?\n\nClosure zeroes current reserves and requires no open reserves, outstanding payments, unresolved liens, or open payment-follow-up diary items.`
    );
    if (!confirmed) return;

    setClosing(true);
    setError('');
    try {
      const closed = await api.claims.close(selectedClaim.id, { expectedVersion: selectedClaim.version });
      await load();
      setSelectedId(closed?.id || selectedClaim.id);
      setNotice(`${closed?.claimNumber || selectedClaim.claimNumber} closed.`);
      refreshSummary();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setClosing(false);
    }
  }

  function renderTab() {
    if (!selectedClaim) return null;
    switch (activeTab) {
      case 'overview':
        return <OverviewTab claim={selectedClaim} related={related} onNavigate={setActiveTab} />;
      case 'reserves':
        return <ReserveTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'coverage':
        return <CoverageTab claim={selectedClaim} />;
      case 'allocations':
        return (
          <AllocationsTab
            claim={selectedClaim}
            related={related}
            onChanged={handleRecordChanged}
          />
        );
      case 'litigation':
        return <LitigationTab claim={selectedClaim} />;
      case 'settlements':
        return <SettlementTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'recovery':
        return <RecoveryLienTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'diary':
        return <DiaryNotesTab claim={selectedClaim} onChanged={handleRecordChanged} />;
      case 'activity':
        return <ActivityTab claim={selectedClaim} />;
      default:
        return <InjuryExposureTab claim={selectedClaim} />;
    }
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Claims · Direct book</div>
          <h1>Direct claims</h1>
          <p className="subtitle">
            FNOL registration and the operational claim record for directly underwritten policies: injuries and
            exposures, reserve history, coverage, litigation, settlements, recovery, and liens.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct" aria-label="Book scope">DIRECT book</span>
          <button type="button" className="eia-btn-ghost" onClick={refresh}>Refresh</button>
          <button type="button" onClick={openRegister} aria-haspopup="dialog">Register claim</button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !registerOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div
            className="eia-queue-search"
            role="search"
            aria-label="Filter the claim queue"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div className="eia-search-box" style={{ height: 38, flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder="Filter claims by number, type, cause, or status…"
                aria-label="Filter claims by number, type, cause, or status"
                title="Also matches the assigned adjuster and team"
                autoComplete="off"
                data-testid="claim-filter"
              />
            </div>
            {queueFilter && (
              <button type="button" className="eia-btn-ghost" onClick={() => setQueueFilter('')}>
                Clear
              </button>
            )}
          </div>

          <aside className="eia-record-list" aria-label="Direct claim queue">
            <div className="eia-record-list-head">
              <strong>Claim queue</strong>
              <span className="eia-muted" data-testid="claim-queue-count">
                {loading ? '…' : queueFilter ? `${filteredClaims.length} of ${claims.length}` : claims.length}
              </span>
            </div>
            {filteredClaims.map((claim) => {
              const owner = assignmentText(claim);
              return (
                <button
                  key={claim.id}
                  type="button"
                  className={claim.id === selectedId ? 'selected' : ''}
                  aria-current={claim.id === selectedId ? 'true' : undefined}
                  onClick={() => selectClaim(claim)}
                >
                  <span className="record-primary">{claim.claimNumber}</span>
                  <span className="record-secondary">Claimant {shortId(claim.claimantPartyId)}</span>
                  <span className="record-secondary" data-testid="queue-assignee">
                    {owner.assignedAdjuster ? `Assigned to ${owner.display}` : 'Unassigned'}
                  </span>
                  <span className="record-secondary" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`eia-pill ${statusTone(claim.status)}`}>{claim.status}</span>
                    <span>Loss {claim.lossDate || '—'}</span>
                  </span>
                </button>
              );
            })}
            {!loading && claims.length > 0 && filteredClaims.length === 0 && (
              <div className="empty">No claims match “{queueFilter.trim()}”. Clear the filter to see the full queue.</div>
            )}
            {!loading && claims.length === 0 && (
              <div className="empty">No DIRECT claims registered yet.</div>
            )}
            {loading && <div className="empty">Loading DIRECT claims…</div>}
          </aside>
        </div>

        <section className="eia-record-panel" aria-label="Claim record">
          {selectedClaim ? (
            <>
              <div className="eia-record-title">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 className="eia-mono">{selectedClaim.claimNumber}</h2>
                    <span className={`eia-pill ${statusTone(selectedClaim.status)}`}>{selectedClaim.status}</span>
                  </div>
                  <p className="eia-record-subtitle" data-testid="record-subtitle">
                    Loss date {selectedClaim.lossDate || '—'} · Reported {selectedClaim.reportDate || '—'} ·{' '}
                    {humanize(selectedClaim.claimType)}{' '}
                    <br />
                    Policy{' '}
                    {selectedClaim.policyId ? (
                      <a
                        href={recordHref('policy', selectedClaim.policyId)}
                        onClick={openRecord}
                        data-testid="header-policy-link"
                        title="Open policy record"
                      >
                        <RelatedLabel related={related.policy} />
                      </a>
                    ) : (
                      '—'
                    )}{' '}
                    · Claimant{' '}
                    {selectedClaim.claimantPartyId ? (
                      <a
                        href={recordHref('party', selectedClaim.claimantPartyId)}
                        onClick={openRecord}
                        data-testid="header-claimant-link"
                        title="Open claimant party record"
                      >
                        <RelatedLabel related={related.party} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </p>
                  <p className="eia-record-subtitle" data-testid="record-assignment">
                    {selectedAssignment.assignedAdjuster ? (
                      <>
                        Assigned to <strong>{selectedAssignment.assignedAdjuster}</strong>
                        {selectedAssignment.assignedTeam ? ` · ${selectedAssignment.assignedTeam}` : ''}
                      </>
                    ) : (
                      'Unassigned'
                    )}
                  </p>
                </div>
                <div className="eia-actions">
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    onClick={openAssignment}
                    aria-haspopup="dialog"
                  >
                    Assign
                  </button>
                  <button type="button" className="eia-btn-ghost" onClick={refresh}>
                    Refresh record
                  </button>
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    onClick={closeClaim}
                    disabled={closing || selectedClaim.status === 'CLOSED'}
                  >
                    {selectedClaim.status === 'CLOSED' ? 'Closed' : closing ? 'Closing…' : 'Close claim'}
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Assigned to</h3>
                  <div className="value" data-testid="summary-assigned-to">
                    {selectedAssignment.assignedAdjuster || 'Unassigned'}
                  </div>
                  <div className="eia-metric-label" data-testid="summary-assigned-team">
                    {selectedAssignment.assignedAdjuster
                      ? selectedAssignment.assignedTeam || 'No team assigned'
                      : 'Ownership queue'}
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Current reserve</h3>
                  <div className="value" data-testid="summary-current-reserve">
                    {money(selectedClaim.currentReserveAmount ?? selectedClaim.reserveAmount, currency)}
                  </div>
                  <div className="eia-metric-label">Component reserve, latest ledger</div>
                </div>
                <div className="eia-card">
                  <h3>Paid loss</h3>
                  <div className="value" data-testid="summary-paid-loss">
                    {summary.paidLoss == null ? '—' : money(summary.paidLoss, currency)}
                  </div>
                  <div className="eia-metric-label">Executed settlement payments</div>
                </div>
                <div className="eia-card">
                  <h3>Recoveries</h3>
                  <div className="value" data-testid="summary-recoveries">
                    {summary.recoveries == null ? '—' : money(summary.recoveries, currency)}
                  </div>
                  <div className="eia-metric-label">Received third-party recoveries</div>
                </div>
                <div className="eia-card">
                  <h3>Settlement authority</h3>
                  <div className="value" data-testid="summary-settlement-authority">
                    {selectedClaim.settlementAuthorityAmount == null
                      ? '—'
                      : money(
                          selectedClaim.settlementAuthorityAmount,
                          selectedClaim.settlementAuthorityCurrency || currency
                        )}
                  </div>
                  <div className="eia-metric-label">Authorized limit before escalation</div>
                </div>
                <div className="eia-card">
                  <h3>Open tasks</h3>
                  <div className="value" data-testid="summary-open-tasks">
                    {summary.openTasks == null ? '—' : summary.openTasks}
                  </div>
                  <div className="eia-metric-label">Open diary items</div>
                </div>
              </div>

              <ClaimProgress claim={selectedClaim} processData={processData} />

              <nav className="eia-tabs" role="tablist" aria-label="Claim sections">
                {TABS.map((tab) => (
                  <a
                    key={tab.id}
                    id={`claim-tab-${tab.id}`}
                    href="#claim-tabpanel"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls="claim-tabpanel"
                    className={`eia-tab ${activeTab === tab.id ? 'active' : ''}`}
                    style={{ textDecoration: 'none' }}
                    onClick={(event) => {
                      event.preventDefault();
                      setActiveTab(tab.id);
                    }}
                  >
                    {tab.label}
                  </a>
                ))}
              </nav>
              <div
                id="claim-tabpanel"
                role="tabpanel"
                aria-labelledby={`claim-tab-${activeTab}`}
              >
                {renderTab()}
              </div>
            </>
          ) : (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the DIRECT claim queue…'
                  : 'Select a claim from the queue or register the first DIRECT claim.'}
              </p>
              {!loading && (
                <button type="button" onClick={openRegister} aria-haspopup="dialog">Register claim</button>
              )}
            </div>
          )}
        </section>
      </div>

      {assignOpen && selectedClaim && (
        <AssignmentDialog
          claim={selectedClaim}
          directory={directoryState.data}
          directoryStatus={directoryState.status}
          onClose={closeAssignment}
          onAssigned={handleAssigned}
          onReload={() => reloadClaimRecord(selectedClaim.id)}
        />
      )}

      {registerOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !registerBusy) closeRegister();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="register-title" style={{ margin: 0 }}>Register claim</h2>
                <p className="eia-record-subtitle">
                  FNOL registration for a directly underwritten policy. The request is walled to the DIRECT book.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeRegister} disabled={registerBusy}>
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <Field label="Policy">
                <EntityPicker
                  endpoint="/api/v1/policies/search"
                  book={BOOK}
                  value={form.policyId}
                  valueLabel={form.policyLabel}
                  onChange={selectPolicy}
                  placeholder="Search policy number or product…"
                  disabled={registerBusy}
                />
                {form.policyId && (
                  <span className="eia-picker-hint">
                    {form.policySecondary || 'Policy selected'} ·{' '}
                    <a
                      href={`/policy?record=${form.policyId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(event.currentTarget.getAttribute('href'));
                      }}
                    >
                      Open policy record
                    </a>
                  </span>
                )}
              </Field>
              <Field label="Claimant party">
                <EntityPicker
                  endpoint="/api/v1/parties/search"
                  value={form.claimantPartyId}
                  valueLabel={form.claimantLabel}
                  onChange={selectClaimantParty}
                  placeholder="Search party number or name…"
                  disabled={registerBusy}
                />
                {form.claimantPartyId && (
                  <span className="eia-picker-hint">
                    {form.claimantSecondary || 'Party selected'} ·{' '}
                    <a
                      href={`/party?record=${form.claimantPartyId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(event.currentTarget.getAttribute('href'));
                      }}
                    >
                      Open claimant party record
                    </a>
                  </span>
                )}
              </Field>
              <Field label="Loss date">
                <input id="lossDate" type="date" value={form.lossDate} onChange={update('lossDate')} required />
              </Field>
              <Field label="Report date">
                <input id="reportDate" type="date" value={form.reportDate} onChange={update('reportDate')} required />
              </Field>
              <Field label="Cause code">
                <input
                  id="causeCode"
                  value={form.causeCode}
                  onChange={update('causeCode')}
                  maxLength={24}
                  placeholder="ACORD / ISO cause"
                />
              </Field>
              <Field label="Claim type">
                <select id="claimType" value={form.claimType} onChange={update('claimType')}>
                  <option value="BODILY_INJURY">Bodily injury</option>
                  <option value="PRODUCT_LIABILITY">Product liability</option>
                  <option value="MASS_TORT">Mass tort</option>
                  <option value="ENVIRONMENTAL">Environmental</option>
                  <option value="PROPERTY_DAMAGE">Property damage</option>
                </select>
              </Field>
              <Field label="Reserve amount">
                <input
                  id="reserveAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.reserveAmount}
                  onChange={update('reserveAmount')}
                  required
                />
              </Field>
              <Field label="Reserve currency">
                <select id="reserveCurrency" value={form.reserveCurrency} onChange={update('reserveCurrency')}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </Field>
              <Field label="Settlement authority">
                <input
                  id="settlementAuthorityAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.settlementAuthorityAmount}
                  onChange={update('settlementAuthorityAmount')}
                  placeholder="Optional authority limit"
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="eia-btn-secondary" onClick={closeRegister} disabled={registerBusy}>
                  Cancel
                </button>
                <button type="submit" disabled={registerBusy}>
                  {registerBusy ? 'Registering…' : 'Register claim'}
                </button>
              </div>
            </form>
            <ErrorText>{error}</ErrorText>
          </section>
        </div>
      )}
    </main>
  );
}
