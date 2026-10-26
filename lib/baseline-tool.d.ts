import type { AlignmentStateStore } from './alignment-state-store.ts';
import { type AlignmentDecisionKind, type DriftReason, type RequirementBaseline } from './types.ts';
/** The drift question's stable id, echoed in the answer. */
export declare const DRIFT_QUESTION_ID = "alignment-drift";
/** Default drift question options when the model supplies none. */
export declare const DEFAULT_DRIFT_OPTIONS: readonly [{
    readonly label: "Approve the direction change";
    readonly description: "Updates the requirement baseline; the new direction is recorded and the work continues.";
}, {
    readonly label: "Stay within the current scope";
    readonly description: "Keeps the requirement baseline unchanged; find another approach or stop.";
}];
/** One model-supplied question option for the drift question. */
export interface DriftOption {
    label: string;
    description?: string;
}
/** The `establish_baseline` tool's validated baseline input. */
export interface BaselineInput {
    goal?: string;
    explicitConstraints?: string[];
    mustPreserve?: string[];
    allowedScope?: string[];
    userDecisions?: string[];
    openDirectionDecisions?: string[];
}
/** Validate baseline input: arrays of strings, at least one meaningful field. */
export declare function validateBaselineInput(input: unknown): BaselineInput;
/** Build a whole-value baseline from validated input, bumping the revision. */
export declare function buildBaseline(input: BaselineInput, current: RequirementBaseline | undefined, now: number): RequirementBaseline;
/** Validate the model-supplied drift question options (2-3 distinct labels). */
export declare function validateDriftOptions(input: unknown): DriftOption[] | undefined;
/** The validated `report_drift` arguments. */
export interface DriftArgs {
    reason: DriftReason;
    description: string;
    requiredChange?: string;
    options?: DriftOption[];
}
/**
 * Validate all `report_drift` arguments before any durable event is written.
 * The tool schema already constrains the happy path; this defensive check
 * guarantees that anything invalid fails with zero session pollution.
 */
export declare function validateDriftArgs(input: unknown): DriftArgs;
/**
 * Present the model-supplied direction options PLUS the two defaults
 * (deduplicated by label). Whatever the model offers, the user always has
 * the exact approve / stay-within-scope options, so a "stay" intent can
 * never be trapped inside a model-rewritten label and mis-recorded as a
 * revised direction.
 */
export declare function withDefaultOptions(options: DriftOption[]): DriftOption[];
/** The model-facing question for one drift candidate. */
export interface DriftQuestion {
    id: string;
    header: string;
    question: string;
    detail: string;
    options: DriftOption[];
}
/** Build the drift question shown to the user. */
export declare function buildDriftQuestion(reason: DriftReason, description: string, requiredChange: string | undefined, options: DriftOption[]): DriftQuestion;
/**
 * Map one user answer to a decision.
 *
 * Semantics:
 * - non-empty free text (`custom`) -> `revise`, note = the user's own words;
 * - a selected default option -> `approve` / `reject` by exact label;
 * - a selected **model-supplied** option (a concrete alternative direction)
 *   -> `revise`, note = the selected option's label — a chosen alternative
 *   is a direction change, never a rejection;
 * - anything that cannot be interpreted reliably (no selection, several
 *   selections, or a label that matches no presented option) throws: fail
 *   loud is better than silently mis-recording the decision as `reject`.
 *
 * @param selected The option labels the user selected.
 * @param custom Free-form "other" answer, when any.
 * @param presented The options the question actually showed (defaults when
 *   the model supplied none).
 * @returns The mapped decision and optional note.
 */
export declare function mapDriftAnswer(selected: readonly string[], custom: string | undefined, presented?: readonly DriftOption[]): {
    decision: AlignmentDecisionKind;
    note?: string;
};
/** The `establish_baseline` tool: silent, never asks the user. */
export declare function registerEstablishBaseline(ctx: import('@deepseek-ai/cordis').Context, store: AlignmentStateStore): () => void;
/** The `report_drift` tool: record a drift candidate, ask the user, record the decision. */
export declare function registerReportDrift(ctx: import('@deepseek-ai/cordis').Context, store: AlignmentStateStore): () => void;
/**
 * The model-facing outcome text for one recorded decision. The exact user
 * choice (note) and the drift's required change are fed back verbatim, so
 * the agent never has to re-ask which direction the user picked.
 *
 * @param decision The recorded verdict.
 * @param note The user's exact choice (free-form answer or selected option
 *   label), when any — normally present for `revise`.
 * @param requiredChange The baseline change the drift candidate required,
 *   when any (echoed for `approve`/`revise`).
 * @returns The outcome text.
 */
export declare function renderDriftOutcome(decision: AlignmentDecisionKind, note?: string, requiredChange?: string): string;
//# sourceMappingURL=baseline-tool.d.ts.map