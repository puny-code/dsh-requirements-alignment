import {} from "./types.js";
/** The all-zero snapshot: no baseline, no drift, no decision, no checks. */
export const EMPTY_ALIGNMENT_STATE = {
    lastBaselineOrder: -1,
    driftCount: 0,
    lastDecisionOrder: -1,
    manualChecks: 0
};
/** Whether a value looks like a baseline payload the fold would accept. */
function isBaselineLike(value) {
    return typeof value === 'object' && value !== null && typeof value.revision === 'number';
}
/** Transition: record (or replace) the whole-value baseline with `order` as its ordering key. */
export function applyBaseline(state, baseline, order) {
    return { ...state, baseline, lastBaselineOrder: order };
}
/** Transition: record one drift candidate at `visibleThroughSeq`. */
export function applyDrift(state, data, visibleThroughSeq) {
    return {
        ...state,
        driftCount: state.driftCount + 1,
        lastDrift: {
            driftSeq: visibleThroughSeq,
            reason: data.reason,
            description: data.description,
            ...(data.requiredChange === undefined ? {} : { requiredChange: data.requiredChange }),
            at: data.at
        }
    };
}
/** Transition: record one user decision on a drift candidate with `order` as its ordering key. */
export function applyDecision(state, data, order) {
    return {
        ...state,
        lastDecision: {
            driftSeq: data.driftSeq,
            decision: data.decision,
            ...(data.note === undefined ? {} : { note: data.note }),
            at: data.at
        },
        lastDecisionOrder: order
    };
}
/** Transition: record one manual `/align` inspection. */
export function applyManualCheck(state, at) {
    return {
        ...state,
        manualChecks: state.manualChecks + 1,
        lastManualCheckAt: at
    };
}
/**
 * Derive the alignment posture from a snapshot — the exact rules of the
 * legacy fold, over the durable state:
 *
 * 1. The last drift has no paired decision -> `drift-pending`.
 * 2. An approve/revise decision that no baseline checkpoint has recorded yet
 *    (the decision is NEWER than the last baseline) -> `baseline-update-pending`.
 * 3. Otherwise the baseline decides `aligned` / `unknown`.
 */
export function deriveAlignmentStatus(state) {
    const driftPending = state.lastDrift !== undefined
        && (state.lastDecision === undefined || state.lastDecision.driftSeq !== state.lastDrift.driftSeq);
    const updatePending = state.lastDecision !== undefined
        && (state.lastDecision.decision === 'approve' || state.lastDecision.decision === 'revise')
        && state.lastDecisionOrder > state.lastBaselineOrder;
    return driftPending
        ? 'drift-pending'
        : updatePending
            ? 'baseline-update-pending'
            : state.baseline === undefined
                ? 'unknown'
                : 'aligned';
}
/** Project a snapshot onto the public {@link AlignmentStatus} shape. */
export function snapshotToStatus(state) {
    return {
        ...(state.baseline === undefined ? {} : { baseline: state.baseline }),
        revision: state.baseline?.revision ?? 0,
        driftCount: state.driftCount,
        ...(state.lastDrift === undefined ? {} : {
            lastDrift: {
                reason: state.lastDrift.reason,
                description: state.lastDrift.description,
                ...(state.lastDrift.requiredChange === undefined ? {} : { requiredChange: state.lastDrift.requiredChange }),
                at: state.lastDrift.at
            }
        }),
        ...(state.lastDecision === undefined ? {} : {
            lastDecision: {
                driftSeq: state.lastDecision.driftSeq,
                decision: state.lastDecision.decision,
                ...(state.lastDecision.note === undefined ? {} : { note: state.lastDecision.note }),
                at: state.lastDecision.at
            }
        }),
        status: deriveAlignmentStatus(state),
        manualChecks: state.manualChecks,
        ...(state.lastManualCheckAt === undefined ? {} : { lastManualCheckAt: state.lastManualCheckAt })
    };
}
/**
 * Resolve the state in force at a log boundary: the LAST checkpoint whose
 * `visibleThroughSeq <= boundary`. Checkpoints must be ordered ascending;
 * an empty timeline yields the all-zero state.
 *
 * @param checkpoints The whole-state checkpoint timeline (ascending).
 * @param boundary The inclusive boundary seq (e.g. a fork's `seedLength - 1`).
 * @returns The state in force at that boundary.
 */
export function stateAt(checkpoints, boundary) {
    let result = EMPTY_ALIGNMENT_STATE;
    for (const checkpoint of checkpoints) {
        if (checkpoint.visibleThroughSeq <= boundary) {
            result = checkpoint.state;
        }
        else {
            break;
        }
    }
    return result;
}
/** The constant empty public status (no baseline, nothing recorded). */
export const EMPTY_ALIGNMENT_STATUS = {
    revision: 0,
    driftCount: 0,
    status: 'unknown',
    manualChecks: 0
};
/**
 * Fold a session log into the legacy checkpoint timeline: one checkpoint per
 * legacy alignment state mutation, `visibleThroughSeq = event.seq`, exactly
 * mirroring {@link foldAlignmentStatus} — including the defensive baseline
 * shape check and the v0.1 `alignment/status` manual-check counting, so an
 * imported timeline and the legacy fold always agree (migration Test K).
 *
 * @param events The session log (or any prefix of it).
 * @returns The ascending checkpoint timeline; empty when the log has no
 *   alignment events.
 */
export function foldLegacyTimeline(events) {
    const checkpoints = [];
    let state = EMPTY_ALIGNMENT_STATE;
    for (const event of events) {
        switch (event.type) {
            case 'alignment/baseline':
            case 'alignment/baseline-updated': {
                const candidate = event.data.baseline;
                if (isBaselineLike(candidate)) {
                    state = applyBaseline(state, candidate, event.seq);
                    checkpoints.push({ visibleThroughSeq: event.seq, state });
                }
                break;
            }
            case 'alignment/drift': {
                const data = event.data;
                state = applyDrift(state, {
                    reason: data.reason,
                    description: data.description,
                    ...(data.requiredChange === undefined ? {} : { requiredChange: data.requiredChange }),
                    at: data.at
                }, event.seq);
                checkpoints.push({ visibleThroughSeq: event.seq, state });
                break;
            }
            case 'alignment/decision': {
                const data = event.data;
                state = applyDecision(state, {
                    driftSeq: data.driftSeq,
                    decision: data.decision,
                    ...(data.note === undefined ? {} : { note: data.note }),
                    at: data.at
                }, event.seq);
                checkpoints.push({ visibleThroughSeq: event.seq, state });
                break;
            }
            case 'alignment/manual-check': {
                state = applyManualCheck(state, event.data.at);
                checkpoints.push({ visibleThroughSeq: event.seq, state });
                break;
            }
            case 'alignment/status': {
                // Legacy v0.1 manual-check snapshots.
                if (event.data.kind === 'manual-check') {
                    state = applyManualCheck(state, event.data.at);
                    checkpoints.push({ visibleThroughSeq: event.seq, state });
                }
                break;
            }
            default:
                break;
        }
    }
    return checkpoints;
}
/** The last snapshot of a timeline (the state at the log head), or the empty state. */
export function latestState(checkpoints) {
    return checkpoints.length === 0 ? EMPTY_ALIGNMENT_STATE : checkpoints[checkpoints.length - 1].state;
}
//# sourceMappingURL=alignment-state.js.map