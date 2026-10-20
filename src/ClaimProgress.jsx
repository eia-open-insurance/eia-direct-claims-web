import React from 'react';

/**
 * Explanatory claim-process stepper. The workbench status and the records that
 * already exist on the claim are used to show where the claim sits; the
 * stepper never gates or performs an action.
 */
const STEPS = [
  { id: 'fnol', label: 'FNOL', purpose: 'Loss reported and registered.' },
  { id: 'coverage', label: 'Coverage', purpose: 'Policy coverage position recorded.' },
  { id: 'reserving', label: 'Reserving', purpose: 'Indemnity and expense reserves set.' },
  { id: 'investigation', label: 'Investigation', purpose: 'Liability, damages, and litigation worked.' },
  { id: 'settlement', label: 'Settlement', purpose: 'Settlement negotiated and approved.' },
  { id: 'payment', label: 'Payment', purpose: 'Payment issued and recoveries booked.' },
  { id: 'closed', label: 'Closed', purpose: 'Claim closed and retained for audit.' }
];

/** First unfinished milestone implied by the current claim status. */
const STATUS_FRONTIER = {
  DRAFT: 0,
  REGISTERED: 1,
  OPEN: 1,
  COVERAGE_REVIEW: 1,
  RESERVED: 3,
  IN_LITIGATION: 3,
  ON_APPEAL: 3,
  REOPENED: 1,
  IN_SETTLEMENT: 4,
  SETTLED: 5,
  PAYMENT_PENDING: 5,
  PAID: 6,
  CLOSED: 7,
  DENIED: 1,
  WITHDRAWN: 6,
  DISMISSED: 6,
  TRANSFERRED: 6,
  BANKRUPTCY_TRUST: 6
};

const ACTIVE_MATTER_STATUSES = ['ACTIVE', 'STAYED', 'ON_APPEAL', 'JUDGMENT'];
const AUTHORIZED_SETTLEMENT_STATUSES = ['AUTHORIZED', 'EXECUTED', 'PAID'];
const PAID_SETTLEMENT_STATUSES = ['PAID'];
const ENDED_STATUSES = ['WITHDRAWN', 'DISMISSED', 'TRANSFERRED', 'BANKRUPTCY_TRUST'];

export const EMPTY_PROCESS = {
  coverage: null,
  reserves: null,
  litigation: [],
  settlements: [],
  recoveries: []
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function upper(value) {
  return String(value || '').toUpperCase();
}

function coverageDecision(value) {
  return value && !Array.isArray(value) ? value : null;
}

function reserveSummary(value) {
  return value && !Array.isArray(value) ? value : null;
}

function stateText(step) {
  if (step.state === 'denied') return 'Denied';
  if (step.complete) return 'Completed';
  if (step.state === 'current') return 'Current step';
  return 'Upcoming';
}

/**
 * Builds the seven-step model from the claim status and the records the
 * workbench already loads. Later evidence can advance the frontier when the
 * status has not caught up yet (for example a posted reserve on an open claim).
 */
export function buildDirectProgress(claim, processData = EMPTY_PROCESS) {
  const status = upper(claim?.status) || 'REGISTERED';
  const coverage = coverageDecision(processData.coverage);
  const reserves = reserveSummary(processData.reserves);
  const matters = asList(processData.litigation);
  const settlements = asList(processData.settlements);
  const recoveries = asList(processData.recoveries);

  const coverageDenied = status === 'DENIED' || upper(coverage?.position) === 'DENIED';
  const closed = status === 'CLOSED';
  const ended = ENDED_STATUSES.includes(status);

  let frontier = STATUS_FRONTIER[status] ?? 1;

  if (!closed && !coverageDenied && !ended) {
    if (coverage) frontier = Math.max(frontier, 2);

    const reserveHistory = asList(reserves?.history);
    const reserveComponents = asList(reserves?.components);
    const hasReserveLedger =
      reserveHistory.length > 0 || reserveComponents.some((row) => Number(row.currentAmount) > 0);
    if (hasReserveLedger) frontier = Math.max(frontier, 3);

    const activeMatter = matters.some((row) => ACTIVE_MATTER_STATUSES.includes(upper(row.status)));
    if (matters.length > 0) frontier = Math.max(frontier, activeMatter ? 3 : 4);

    const settlementStatuses = settlements.map((row) => upper(row.status));
    if (settlementStatuses.includes('PROPOSED')) frontier = Math.max(frontier, 4);
    if (settlementStatuses.some((value) => AUTHORIZED_SETTLEMENT_STATUSES.includes(value))) {
      frontier = Math.max(frontier, 5);
    }
    if (settlementStatuses.some((value) => PAID_SETTLEMENT_STATUSES.includes(value))) {
      frontier = Math.max(frontier, 6);
    }

    // A received recovery is financial activity after settlement, so it is
    // enough evidence that the claim has reached the payment phase.
    if (recoveries.some((row) => upper(row.status) === 'RECEIVED')) frontier = Math.max(frontier, 5);
    if (Number(processData.paidLoss) > 0) frontier = Math.max(frontier, 6);
  }

  if (coverageDenied) frontier = 1;
  if (ended) frontier = 6;
  if (closed) frontier = STEPS.length;

  const last = STEPS.length - 1;
  const currentIndex = closed ? last : Math.min(frontier, last);

  const steps = STEPS.map((step, index) => {
    let state;
    let complete = closed ? true : index < frontier;

    if (index === 1 && coverageDenied) {
      // A recorded denial is shown on the coverage step even when the claim was
      // later closed through the denial path.
      state = 'denied';
      complete = false;
    } else if (closed) {
      state = index === last ? 'current' : 'completed';
    } else if (index < frontier) {
      state = 'completed';
    } else if (index === currentIndex) {
      state = 'current';
    } else {
      state = 'upcoming';
    }

    return {
      ...step,
      state,
      complete,
      current: index === currentIndex && !(coverageDenied && index !== 1)
    };
  });

  const current = steps[currentIndex];
  let next;

  if (closed) {
    next = 'The claim is closed; reserves, settlements, and the financial history remain available for audit.';
  } else if (coverageDenied) {
    next = 'Coverage is denied; the claim can be closed, and the denial and its rationale stay on the record.';
  } else if (ended) {
    next = 'Claim handling ended outside the standard payment path; the record remains available for audit.';
  } else if (current.id === 'fnol') {
    next = 'Confirm the loss details and assign the handler; the policy and claimant are already on the record.';
  } else if (current.id === 'coverage') {
    next = 'Review the policy terms, limits, and exclusions, then record the coverage position.';
  } else if (current.id === 'reserving') {
    next = 'Set indemnity, defense, and expense reserves from the known exposure; later changes post to reserve history.';
  } else if (current.id === 'investigation') {
    const activeMatter = matters.some((row) => ACTIVE_MATTER_STATUSES.includes(upper(row.status)));
    next = activeMatter
      ? 'Work the open litigation matter alongside liability and damages, and update the matter as it progresses.'
      : 'Establish liability and damages, and record injuries, exposures, or litigation detail as they emerge.';
  } else if (current.id === 'settlement') {
    const proposed = settlements.some((row) => upper(row.status) === 'PROPOSED');
    next = proposed
      ? 'Negotiate and approve the proposed settlement; approval moves the claim to payment.'
      : 'Negotiate and approve the settlement, then move the claim to payment.';
  } else if (current.id === 'payment') {
    const receivedRecovery = recoveries.some((row) => upper(row.status) === 'RECEIVED');
    next = receivedRecovery
      ? 'Confirm the payment is issued and reconcile the received recoveries against the paid loss.'
      : 'Execute the settlement, issue payment, and record any recoveries or liens.';
  } else {
    next = 'Payment is recorded; close the claim once recoveries and liens are reconciled.';
  }

  return {
    steps,
    currentIndex,
    next,
    stageLabel: `${current.label} · step ${currentIndex + 1} of ${STEPS.length}`
  };
}

export default function ClaimProgress({ claim, processData }) {
  const model = buildDirectProgress(claim, processData);

  return (
    <section className="eia-process" aria-label="Claim progress" data-testid="claim-progress">
      <div className="eia-process-head">
        <h3 className="eia-process-title">Claim progress</h3>
        <span className="eia-process-stage" data-testid="process-stage">{model.stageLabel}</span>
      </div>
      <ol
        className="eia-process-track"
        aria-label="Claim process steps"
        style={{ '--eia-process-steps': model.steps.length }}
      >
        {model.steps.map((step, index) => (
          <li
            key={step.id}
            className="eia-process-step"
            data-testid={`process-step-${step.id}`}
            data-state={step.state}
            data-complete={step.complete ? 'true' : 'false'}
            data-current={step.current ? 'true' : 'false'}
            aria-current={step.current ? 'step' : undefined}
          >
            <span className="eia-process-marker" aria-hidden="true">
              {step.state === 'denied' ? '✕' : step.complete ? '✓' : index + 1}
            </span>
            <span className="eia-process-copy">
              <span className="eia-visually-hidden">{stateText(step)}. </span>
              <span className="eia-process-label">{step.label}</span>
              <span className="eia-process-purpose">{step.purpose}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="eia-process-next" data-testid="process-next">
        <b>What happens next:</b>
        <span>{model.next}</span>
      </p>
    </section>
  );
}
