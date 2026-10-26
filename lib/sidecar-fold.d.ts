import type { AlignmentSessionRecord } from './alignment-state-store.ts';
import type { AlignmentStatus } from './types.ts';
/** The JSON unit document the storage-json backend writes for this domain. */
export interface AlignmentSidecarDocument {
    unit?: {
        name?: string;
        version?: number;
    };
    tables?: {
        sessions?: Record<string, AlignmentSessionRecord>;
    };
}
/** Parse a sidecar unit file; rejects a foreign unit name. */
export declare function parseSidecarDocument(text: string): Record<string, AlignmentSessionRecord>;
/** Public alignment status of one sidecar record (latest checkpoint). */
export declare function statusFromSidecarRecord(record: AlignmentSessionRecord): AlignmentStatus;
/**
 * Simulate a post-resume `establish_baseline` against a sidecar record: bump
 * the revision, set `goal`, and derive the resulting status. Used by dogfood
 * cases 11/12 (the headless runner has no CLI resume).
 */
export declare function simulateSidecarBaselineUpdate(record: AlignmentSessionRecord, goal: string, now?: number): AlignmentStatus;
//# sourceMappingURL=sidecar-fold.d.ts.map