/**
 * Log folding for Requirements Alignment — the LEGACY compatibility layer.
 *
 * Since the persistence-compatibility fix, canonical alignment state lives in
 * the AlignmentStateStore sidecar (`src/alignment-state-store.ts`); this
 * module is kept for:
 *
 *   - legacy v0.1/v0.2 session import and migration validation,
 *   - compatibility fixtures and historical recovery,
 *   - the store's own derived fallbacks (a parent without a sidecar record
 *     folds its seed prefix through the exact same rules).
 *
 * The fold functions below MUST keep their semantics byte-for-byte stable —
 * the migration import (`foldLegacyTimeline` in `src/alignment-state.ts`)
 * mirrors them, so `foldAlignmentStatus(legacyEvents)` and the imported
 * sidecar state always agree.
 *
 * @module dsh-requirements-alignment/status
 */
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import { type AlignmentDecisionKind, type AlignmentStatus, type BaselineEvent, type DecisionEvent, type DriftEvent, type DriftReason, type ManualCheckEvent, type RequirementBaseline } from './types.ts';
/** A minimal receiver the append helpers can write to (real Session or test double). */
export interface AlignmentLog {
    append(type: 'alignment/baseline', data: BaselineEvent): SessionEvent<'alignment/baseline'>;
    append(type: 'alignment/baseline-updated', data: BaselineEvent): SessionEvent<'alignment/baseline-updated'>;
    append(type: 'alignment/drift', data: DriftEvent): SessionEvent<'alignment/drift'>;
    append(type: 'alignment/decision', data: DecisionEvent): SessionEvent<'alignment/decision'>;
    append(type: 'alignment/manual-check', data: ManualCheckEvent): SessionEvent<'alignment/manual-check'>;
}
/**
 * Fold the current requirement baseline. The last baseline event wins
 * (whole-value replace, like `plan/mode`); events whose payload is not a
 * baseline-shaped object are ignored defensively.
 *
 * @param events The session log or any prefix of it.
 * @returns The baseline in force, or `undefined` when none is recorded.
 */
export declare function foldRequirementBaseline(events: readonly SessionEvent[]): RequirementBaseline | undefined;
/**
 * Fold one session log into its alignment status: baseline, revision, drift
 * events, last drift, last decision, manual checks, and the derived posture.
 * `tool/call` events never participate, so unrelated `ask_user_question`
 * calls (plan mode, other plugins, ordinary agent questions) cannot pollute
 * alignment state.
 *
 * @param events The session log or any prefix of it.
 * @returns The folded status; a log with no alignment events is all-zero.
 */
export declare function foldAlignmentStatus(events: readonly SessionEvent[]): AlignmentStatus;
/**
 * @deprecated LEGACY-ONLY. The legacy append helpers below exist ONLY for
 * compatibility tests and migration fixtures. Production code MUST NOT call
 * them: appending `alignment/*` events to a live session makes the persisted
 * log unreadable to every DSH build (the generated `KNOWN_SESSION_EVENT_TYPES`
 * does not contain them). Use AlignmentStateStore (`recordBaseline`,
 * `recordDrift`, `recordDecision`, `recordManualCheck`) instead.
 */
/** @internal legacy-only — append the initial baseline (revision >= 1). */
export declare function appendBaseline(session: AlignmentLog, baseline: RequirementBaseline): void;
/** @internal legacy-only — append a revised baseline (whole-value replace, revision increments). */
export declare function appendBaselineUpdated(session: AlignmentLog, baseline: RequirementBaseline): void;
/**
 * @internal legacy-only — append one drift candidate and return the logged
 * event, so the caller can pair the later decision by `event.seq`.
 */
export declare function appendDrift(session: AlignmentLog, data: DriftEvent): SessionEvent<'alignment/drift'>;
/** @internal legacy-only — append one user decision on a drift candidate. */
export declare function appendDecision(session: AlignmentLog, data: DecisionEvent): void;
/**
 * @internal legacy-only — append one manual `/align` inspection.
 *
 * @param session The session (or double) to append to.
 * @param at Epoch milliseconds of the check; defaults to now.
 */
export declare function appendManualCheck(session: AlignmentLog, at?: number): void;
export type { Session, AlignmentStatus, AlignmentDecisionKind, DriftReason, RequirementBaseline };
//# sourceMappingURL=status.d.ts.map