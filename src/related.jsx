import React, { useEffect, useState } from 'react';
import { api, BOOK } from './api.js';
import { shortId } from './ui.jsx';

const EMPTY = { state: 'idle', label: '', id: '', detail: null };

/**
 * Related labels are a non-blocking enhancement: the claim record renders
 * immediately with the short UUID, then the link text is replaced when the
 * policy and party detail lookups settle. A failed lookup keeps the UUID.
 */

export function isDirectClaim(claim) {
  // Records that explicitly belong to another book must never be looked up on
  // this workbench. A missing businessBook is treated as DIRECT because the
  // claim queue itself is served from the DIRECT book wall.
  return Boolean(claim?.id) && (!claim.businessBook || claim.businessBook === BOOK);
}

export function policyLabel(policy) {
  if (!policy) return '';
  return [policy.policyNumber, policy.productCode].filter(Boolean).join(' · ');
}

export function partyLabel(party) {
  if (!party) return '';
  return [party.displayName, party.partyNumber].filter(Boolean).join(' · ');
}

function initial(id) {
  return id ? { state: 'loading', label: '', id, detail: null } : EMPTY;
}

function idle(id) {
  return id ? { state: 'idle', label: '', id, detail: null } : EMPTY;
}

function resolved(kind, id, detail) {
  return {
    state: 'ready',
    label: kind === 'policy' ? policyLabel(detail) : partyLabel(detail),
    id,
    detail
  };
}

function failed(id) {
  return { state: 'error', label: '', id, detail: null };
}

function textOf(entry) {
  return entry.label || (entry.id ? shortId(entry.id) : '');
}

export function useRelatedLabels(claim) {
  const claimId = claim?.id || '';
  const direct = isDirectClaim(claim);
  const claimPolicyId = claim?.policyId ? String(claim.policyId) : '';
  const claimPartyId = claim?.claimantPartyId ? String(claim.claimantPartyId) : '';
  // Assumed records keep their ids for the visible UUID fallback but never
  // receive a lookup request.
  const policyId = direct ? claimPolicyId : '';
  const partyId = direct ? claimPartyId : '';
  const key = `${claimId}|${direct}|${claimPolicyId}|${claimPartyId}`;

  const baseEntry = (id) => (direct ? initial(id) : idle(id));

  const [snapshot, setSnapshot] = useState({ key: '', policy: EMPTY, party: EMPTY });

  useEffect(() => {
    if (!claimId) {
      setSnapshot({ key, policy: EMPTY, party: EMPTY });
      return undefined;
    }

    let alive = true;
    setSnapshot({ key, policy: baseEntry(claimPolicyId), party: baseEntry(claimPartyId) });

    const patch = (field, value) => {
      if (!alive) return;
      setSnapshot((current) => (current.key === key ? { ...current, [field]: value } : current));
    };

    if (policyId) {
      api.policies
        .get(policyId)
        .then((body) => patch('policy', resolved('policy', policyId, body)))
        .catch(() => patch('policy', failed(policyId)));
    }

    if (partyId) {
      api.parties
        .get(partyId)
        .then((body) => patch('party', resolved('party', partyId, body)))
        .catch(() => patch('party', failed(partyId)));
    }

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, claimId, policyId, partyId]);

  const current =
    snapshot.key === key
      ? snapshot
      : { key, policy: baseEntry(claimPolicyId), party: baseEntry(claimPartyId) };

  return {
    claimId,
    direct,
    policy: { ...current.policy, text: textOf(current.policy) },
    party: { ...current.party, text: textOf(current.party) }
  };
}

/** Renders the resolved label, the short-UUID fallback, and a subtle pending marker. */
export function RelatedLabel({ related }) {
  const text = related?.text || '—';
  return (
    <>
      {text}
      {related?.state === 'loading' ? (
        <span className="eia-link-pending" aria-hidden="true">
          {' '}
          …
        </span>
      ) : null}
    </>
  );
}
