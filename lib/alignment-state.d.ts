/**
 * Pure alignment domain state for Requirements Alignment: the durable
 * per-session snapshot, the whole-state checkpoint timeline that supports
 * historical fork, and the transitions that mirror the legacy fold
 * semantics exactly.
 *
 * This module is deliberately free of host-side value imports (no cordis,
 * no storage, no I/O): the same pure functions drive the legacy fold
 * compatibility layer, the durable sidecar store, and the migration import,
 * so every path derives the same AlignmentStatus.
 *
 * Checkpoint semantics:
 *
 *   { visibleThroughSeq: N, state }  — `state` is the complete alignment
 *   state in force once the session log has reached N events. Because
 *   DSH logs are append-only with contiguous seqs, "fork @ boundary B"
 *   (inclusive last inherited event seq, the official `seedLength - 1`)
 *   resolves to the LAST checkpoint with `visibleThroughSeq <= B`.
 *
 * @module dsh-requirements-alignment/alignment-state
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import { type AlignmentDecisionKind, type AlignmentStatus, type AlignmentStatusValue, type DriftReason, type RequirementBaseline } from './types.ts';
/**
 * The durable per-session alignment state — one checkpoint value. Mirrors
 * every field the legacy fold derives, plus the two seq anchors the posture
 * derivation needs (`lastBaselineSeq` / `lastDecisionSeq`).
 */
export interface AlignmentStateSnapshot {
    /** The baseline in force, when any baseline was recorded. */
    baseline?: RequirementBaseline;
    /**
     * The ORDERING key of the checkpoint that recorded the current baseline
     * (`-1` when none). For legacy timelines this is the baseline event's
     * seq (events are ordered by seq); for store mutations it is a
     * per-session monotonic mutation counter. The posture derivation needs it
     * to tell "decision newer than the last baseline"
     * (baseline-update-pending) apart from "decision already recorded by a
     * newer baseline" (aligned) — the log position alone cannot order two
     * mutations recorded at the same log length.
     */
    lastBaselineOrder: number;
    /** Number of drift candidates recorded (whole log). */
    driftCount: number;
    /** The last drift candidate, when any. */
    lastDrift?: {
        /**
         * The visibleThroughSeq of the drift checkpoint — the pairing key the
         * later decision references (the durable successor of the old
         * `alignment/drift` event seq).
         */
        driftSeq: number;
        reason: DriftReason;
        description: string;
        requiredChange?: string;
        at: number;
    };
    /** The last user decision, when any. */
    lastDecision?: {
        driftSeq: number;
        decision: AlignmentDecisionKind;
        note?: string;
        at: number;
    };
    /** The ORDERING key of the checkpoint that recorded the last decision (`-1` when none). */
    lastDecisionOrder: number;
    /** Number of manual `/align` inspections (new and legacy). */
    manualChecks: number;
    /** Epoch ms of the last manual `/align` inspection, when any. */
    lastManualCheckAt?: number;
}
/** The all-zero snapshot: no baseline, no drift, no decision, no checks. */
export declare const EMPTY_ALIGNMENT_STATE: AlignmentStateSnapshot;
/**
 * One whole-state checkpoint. `state` is the full alignment state that
 * became visible when the session log reached `visibleThroughSeq` events.
 */
export interface AlignmentCheckpoint {
    /** Session log length (seq boundary) at which `state` became visible. */
    visibleThroughSeq: number;
    /** The complete alignment state from that boundary on. */
    state: AlignmentStateSnapshot;
}
/** Transition: record (or replace) the whole-value baseline with `order` as its ordering key. */
export declare function applyBaseline(state: AlignmentStateSnapshot, baseline: RequirementBaseline, order: number): AlignmentStateSnapshot;
/** Transition: record one drift candidate at `visibleThroughSeq`. */
export declare function applyDrift(state: AlignmentStateSnapshot, data: {
    reason: DriftReason;
    description: string;
    requiredChange?: string;
    at: number;
}, visibleThroughSeq: number): AlignmentStateSnapshot;
/** Transition: record one user decision on a drift candidate with `order` as its ordering key. */
export declare function applyDecision(state: AlignmentStateSnapshot, data: {
    driftSeq: number;
    decision: AlignmentDecisionKind;
    note?: string;
    at: number;
}, order: number): AlignmentStateSnapshot;
/** Transition: record one manual `/align` inspection. */
export declare function applyManualCheck(state: AlignmentStateSnapshot, at: number): AlignmentStateSnapshot;
/**
 * Derive the alignment posture from a snapshot — the exact rules of the
 * legacy fold, over the durable state:
 *
 * 1. The last drift has no paired decision -> `drift-pending`.
 * 2. An approve/revise decision that no baseline checkpoint has recorded yet
 *    (the decision is NEWER than the last baseline) -> `baseline-update-pending`.
 * 3. Otherwise the baseline decides `aligned` / `unknown`.
 */
export declare function deriveAlignmentStatus(state: AlignmentStateSnapshot): AlignmentStatusValue;
/** Project a snapshot onto the public {@link AlignmentStatus} shape. */
export declare function snapshotToStatus(state: AlignmentStateSnapshot): AlignmentStatus;
/**
 * Resolve the state in force at a log boundary: the LAST checkpoint whose
 * `visibleThroughSeq <= boundary`. Checkpoints must be ordered ascending;
 * an empty timeline yields the all-zero state.
 *
 * @param checkpoints The whole-state checkpoint timeline (ascending).
 * @param boundary The inclusive boundary seq (e.g. a fork's `seedLength - 1`).
 * @returns The state in force at that boundary.
 */
export declare function stateAt(checkpoints: readonly AlignmentCheckpoint[], boundary: number): AlignmentStateSnapshot;
/** The constant empty public status (no baseline, nothing recorded). */
export declare const EMPTY_ALIGNMENT_STATUS: AlignmentStatus;
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
export declare function foldLegacyTimeline(events: readonly SessionEvent[]): AlignmentCheckpoint[];
/** The last snapshot of a timeline (the state at the log head), or the empty state. */
export declare function latestState(checkpoints: readonly AlignmentCheckpoint[]): AlignmentStateSnapshot;
export type { AlignmentDecisionKind, AlignmentStatus, AlignmentStatusValue, DriftReason, RequirementBaseline };
//# sourceMappingURL=alignment-state.d.ts.map