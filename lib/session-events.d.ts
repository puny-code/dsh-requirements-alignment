import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
/** DSH 0.1.2+ reads history on demand; older hosts expose an events array. */
export interface SessionEventSource {
    readonly events?: readonly SessionEvent[];
    snapshotEvents?(): readonly SessionEvent[];
}
export declare function sessionEvents(session: SessionEventSource): readonly SessionEvent[];
//# sourceMappingURL=session-events.d.ts.map