import React, { useEffect, useRef, useState } from 'react';
import { api, money } from './api.js';
import { humanize, Panel } from './ui.jsx';

/** The activity card reads one bounded page of the claim's inbox events. */
export const ACTIVITY_LIMIT = 50;

/**
 * Human labels for the Direct Claims event names that are published today.
 * The event type itself is always shown in mono beside the label, so an
 * unmapped name still gives the reader the exact contract name.
 */
const EVENT_LABELS = {
  'direct.claim.registered': 'Claim registered',
  'direct.claim.updated': 'Claim updated',
  'direct.claim.assigned': 'Claim assigned',
  'direct.claim.coverage-assessed': 'Coverage assessed',
  'direct.claim.injury-recorded': 'Injury recorded',
  'direct.claim.exposure-recorded': 'Exposure recorded',
  'direct.claim.reserve-established': 'Reserve established',
  'direct.claim.reserve-changed': 'Reserve changed',
  'direct.claim.settlement-authorized': 'Settlement authorized',
  'direct.claim.settlement-executed': 'Settlement executed',
  'direct.claim.task-created': 'Diary task created',
  'direct.claim.task-completed': 'Diary task completed',
  'direct.claim.task-updated': 'Diary task updated',
  'direct.claim.note-added': 'Note added',
  'direct.claim.litigation-updated': 'Litigation updated',
  'direct.claim.payment-requested': 'Payment requested',
  'direct.claim.paid': 'Claim paid',
  'direct.claim.recovery-recorded': 'Recovery recorded',
  'direct.claim.lien-recorded': 'Lien recorded',
  'direct.claim.lien-resolved': 'Lien resolved',
  'direct.claim.allocated': 'Claim allocated',
  'direct.claim.closed': 'Claim closed',
  'direct.claim.reopened': 'Claim reopened',
  'direct.claim.transferred': 'Claim transferred'
};

const FAILED_EVENT_STATUSES = ['FAILED', 'DEAD_LETTERED', 'REJECTED'];
const PROCESSED_EVENT_STATUSES = ['PROCESSED', 'APPLIED', 'COMPLETED'];
const PENDING_EVENT_STATUSES = ['RECEIVED', 'PENDING', 'RETRYING'];

function upper(value) {
  return String(value || '').toUpperCase();
}

/** `direct.claim.registered` -> `Claim registered`; unmapped names degrade gracefully. */
export function humanEventType(eventType) {
  const type = String(eventType || '').trim();
  if (!type) return 'Unknown event';
  if (EVENT_LABELS[type]) return EVENT_LABELS[type];
  const segment = type.split('.').filter(Boolean).pop() || type;
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

/** Inbox lifecycle tone: processed is settled, failed is red, received is pending. */
export function eventStatusTone(status) {
  const value = upper(status);
  if (FAILED_EVENT_STATUSES.includes(value)) return 'red';
  if (PROCESSED_EVENT_STATUSES.includes(value)) return 'green';
  if (PENDING_EVENT_STATUSES.includes(value)) return 'amber';
  return 'blue';
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
 * The inbox view may expose `payload` as a decoded object or as the raw JSON
 * text. Both are accepted; a payload that cannot be read simply adds no facts.
 */
export function readPayload(event) {
  let payload = event?.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function excerpt(value, max = 120) {
  const body = text(value).replace(/\s+/g, ' ');
  if (!body) return '';
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

function isTaskEvent(eventType, payload) {
  return Boolean(text(payload.taskId) || text(payload.taskNumber)) || /(^|\.)task(-|$)/.test(eventType);
}

function isNoteEvent(eventType, payload) {
  return Boolean(text(payload.noteId) || text(payload.noteNumber)) || /(^|\.)note(-|$)/.test(eventType);
}

/**
 * A compact, claim-readable summary of the event payload. Only the facts the
 * workbench can explain are surfaced: status transitions, reserve movements,
 * coverage position, settlement amount, the affected task or note, and the
 * payment source. Unknown payload shapes add nothing rather than guessing.
 */
export function eventPayloadFacts(event, fallbackCurrency = 'USD') {
  const payload = readPayload(event);
  if (!payload) return [];

  const eventType = text(event?.eventType);
  const baseCurrency = text(fallbackCurrency) || 'USD';
  const facts = [];

  const from = text(payload.from);
  const to = text(payload.to);
  if (from || to) {
    facts.push({
      key: 'status',
      label: 'Status',
      value: from && to ? `${from} → ${to}` : to || from
    });
  }

  const reserveAmount = payload.amount ?? payload.reserveAmount ?? payload.finalReserveAmount;
  if (text(reserveAmount) !== '') {
    facts.push({
      key: 'reserve',
      label: 'Reserve amount',
      value: money(reserveAmount, text(payload.currency) || text(payload.reserveCurrency) || baseCurrency)
    });
  }
  if (text(payload.component)) {
    facts.push({
      key: 'reserveComponent',
      label: 'Reserve component',
      value: humanize(payload.component)
    });
  }

  if (text(payload.position)) {
    facts.push({
      key: 'position',
      label: 'Coverage position',
      value: humanize(payload.position)
    });
  }

  if (text(payload.settlementAmount) !== '') {
    facts.push({
      key: 'settlement',
      label: 'Settlement amount',
      value: money(payload.settlementAmount, text(payload.settlementCurrency) || baseCurrency)
    });
  }

  if (isTaskEvent(eventType, payload)) {
    const title = text(payload.title) || text(payload.taskNumber);
    if (title) facts.push({ key: 'task', label: 'Task', value: title });
  } else if (isNoteEvent(eventType, payload)) {
    const note = [
      text(payload.title) || (text(payload.noteType) ? humanize(payload.noteType) : ''),
      excerpt(payload.body)
    ]
      .filter(Boolean)
      .join(' · ');
    if (note) facts.push({ key: 'note', label: 'Note', value: note });
  } else if (text(payload.title)) {
    facts.push({ key: 'title', label: 'Title', value: text(payload.title) });
  }

  const paymentSource =
    text(typeof payload.paymentSource === 'string' ? payload.paymentSource : '') ||
    [text(payload.sourceType), text(payload.sourceReference) || text(payload.sourceId)]
      .filter(Boolean)
      .join(' · ');
  if (paymentSource) {
    facts.push({ key: 'paymentSource', label: 'Payment source', value: paymentSource });
  }

  return facts;
}

function eventTime(event) {
  const value = Date.parse(event?.occurredAt || event?.receivedAt || '');
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Newest first, independent of the order the page happens to arrive in. The
 * aggregate version is the tiebreaker for events that share an occurredAt.
 */
export function sortEvents(events) {
  return [...events].sort((left, right) => {
    const byTime = eventTime(right) - eventTime(left);
    if (byTime !== 0) return byTime;
    return (Number(right?.aggregateVersion) || 0) - (Number(left?.aggregateVersion) || 0);
  });
}

/** The aggregate endpoint returns `{aggregateId, limit, items}`; tolerate a bare array. */
export function eventItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

export default function ActivityTab({ claim }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const shownClaimRef = useRef(null);

  useEffect(() => {
    if (shownClaimRef.current !== claim.id) {
      // Never show one claim's events under another claim's header.
      shownClaimRef.current = claim.id;
      setEvents([]);
    }

    let alive = true;
    setLoading(true);
    setError('');
    api.events
      .aggregate(claim.id, ACTIVITY_LIMIT)
      .then((body) => {
        if (!alive) return;
        setEvents(sortEvents(eventItems(body)));
      })
      .catch((cause) => {
        if (!alive) return;
        setEvents([]);
        setError(cause?.message || 'The event inbox could not be reached.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [claim.id, reloadNonce]);

  const currency = claim.reserveCurrency || 'USD';
  const countLabel = loading
    ? events.length > 0
      ? 'Refreshing activity…'
      : 'Loading activity…'
    : error
      ? 'Activity unavailable'
      : `${events.length} event${events.length === 1 ? '' : 's'}`;

  return (
    <>
      <Panel title="Activity timeline">
        <div className="eia-toolbar" style={{ marginBottom: 4 }}>
          <span className="eia-muted" data-testid="activity-count">
            {countLabel}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="eia-btn-ghost"
            data-testid="activity-refresh"
            aria-label="Refresh activity"
            onClick={() => setReloadNonce((value) => value + 1)}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
        <p className="eia-muted" style={{ margin: '0 0 4px', fontSize: 12 }}>
          Events received by the platform event inbox for this claim, newest first. The request is
          card-local: a slow or unavailable inbox never blocks the claim record.
        </p>

        {loading && events.length === 0 && (
          <p className="eia-muted" data-testid="activity-loading" role="status" style={{ margin: '12px 0 0' }}>
            Loading claim activity…
          </p>
        )}

        {error && (
          <p role="alert" data-testid="activity-error" style={{ margin: '8px 0 0' }}>
            Claim activity could not be loaded: {error} The claim record is unaffected.
          </p>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>No events have been received for this claim yet.</p>
            <p style={{ marginTop: 0 }}>
              Events appear here after the event inbox delivers them. The business claim record remains
              the source of truth.
            </p>
          </div>
        )}

        {events.length > 0 && (
          <ol className="eia-timeline" data-testid="activity-timeline" aria-label="Claim activity timeline">
            {events.map((event, index) => {
              const facts = eventPayloadFacts(event, currency);
              const eventType = event.eventType || 'unknown';
              return (
                <li
                  key={event.eventId || `${eventType}-${event.aggregateVersion ?? index}-${index}`}
                  className="eia-timeline-item"
                  data-testid="activity-item"
                >
                  <div className="eia-timeline-head eia-activity-head">
                    <time
                      className="eia-activity-time"
                      data-testid="activity-time"
                      dateTime={event.occurredAt || undefined}
                    >
                      {formatTimestamp(event.occurredAt)}
                    </time>
                    <span className="eia-activity-label" data-testid="activity-label">
                      {humanEventType(eventType)}
                    </span>
                    <span
                      className={`eia-pill ${eventStatusTone(event.status)}`}
                      data-testid="activity-status"
                    >
                      {event.status || 'UNKNOWN'}
                    </span>
                    <span className="eia-mono eia-activity-version" data-testid="activity-version">
                      v{event.eventVersion ?? '—'}
                    </span>
                  </div>

                  {facts.length > 0 && (
                    <ul className="eia-activity-facts" data-testid="activity-facts">
                      {facts.map((fact) => (
                        <li
                          key={fact.key}
                          className="eia-activity-fact"
                          data-testid={`activity-fact-${fact.key}`}
                        >
                          <span className="eia-activity-fact-label">{fact.label}</span>
                          <span>{fact.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="eia-activity-raw eia-mono" data-testid="activity-raw-type">
                    {eventType}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <section
        className="eia-context-panel"
        aria-label="About the claim activity timeline"
        data-testid="activity-context"
      >
        <h4>About this timeline</h4>
        <p>
          Activity is derived from the platform event inbox, not from the claim tables. The business
          claim record remains the source of truth for status, reserves, coverage, settlements, and
          payments; this timeline is a read-only projection that can lag behind, or miss, a delivery.
          Events are append-only and are never edited or deleted on this screen.
        </p>
      </section>
    </>
  );
}
