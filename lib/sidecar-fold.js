/**
 * Read helpers for the persisted AlignmentStateStore sidecar document
 * (`storages/requirements_alignment.json`). Used by dogfood interruption
 * checks (`scripts/fold-session.mjs`) so they fold the canonical medium,
 * never the session log.
 *
 * @module dsh-requirements-alignment/sidecar-fold
 */
import { applyBaseline, latestState, snapshotToStatus } from "./alignment-state.js";
import { buildBaseline } from "./baseline-tool.js";
/** Parse a sidecar unit file; rejects a foreign unit name. */
export function parseSidecarDocument(text) {
    const document = JSON.parse(text);
    if (document.unit?.name !== 'requirements_alignment') {
        throw new Error(`not a requirements_alignment sidecar document (unit ${JSON.stringify(document.unit?.name)})`);
    }
    return document.tables?.sessions ?? {};
}
/** Public alignment status of one sidecar record (latest checkpoint). */
export function statusFromSidecarRecord(record) {
    return snapshotToStatus(latestState(record.checkpoints));
}
/**
 * Simulate a post-resume `establish_baseline` against a sidecar record: bump
 * the revision, set `goal`, and derive the resulting status. Used by dogfood
 * cases 11/12 (the headless runner has no CLI resume).
 */
export function simulateSidecarBaselineUpdate(record, goal, now = Date.now()) {
    const current = latestState(record.checkpoints);
    const order = Math.max(current.lastBaselineOrder, current.lastDecisionOrder) + 1;
    const baseline = buildBaseline({ goal }, current.baseline, now);
    return snapshotToStatus(applyBaseline(current, baseline, order));
}
//# sourceMappingURL=sidecar-fold.js.map