/**
 * Management API for the Requirements Alignment floating manager.
 *
 * Mounted on the DSH web server under /_dsh/requirements-alignment. Loopback
 * only, with Host + Origin + Content-Type + custom-header checks on every
 * mutation (CSRF defense, same recipe as dsh-chatgpt-bridge). GET endpoints
 * never mutate. The endpoints are the server half of the `shell.overlay`
 * capsule; every mutation is exercised through the SAME controller paths the
 * `/align-mode` command uses, so the widget and the command can never
 * disagree about the mode model.
 *
 *   GET      /status?sessionId=   four-layer picture + folded baseline
 *   PUT      /mode?sessionId=     { mode }  → session-scoped override
 *   DELETE   /mode?sessionId=                → clear session override
 *   PUT      /shared-mode         { mode }  → shared runtime override
 *   DELETE   /shared-mode                   → reset shared override
 *
 * A sessionId that is not a live session resolves to an error (the floating
 * manager only ever addresses the currently selected session, which is always
 * live). Session lookup goes through the controller's live-session registry
 * (`ctx.agents`) — the same layer `/align-mode` operates on.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequirementsAlignmentController } from './index.ts';
/** The base path all management routes are mounted under. */
export declare const ROUTE_BASE = "/_dsh/requirements-alignment";
/** Distinct CSRF header so a malicious third-party page cannot forge mutations. */
export declare const MUTATION_HEADER = "x-dsh-requirements-alignment";
/** Minimal web-server seam (the DSH web server's `register` surface). */
export interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/** The four-layer + baseline picture the capsule renders. */
export interface AlignmentStatusPayload {
    ok: true;
    session: {
        id: string;
        effectiveMode: 'auto' | 'manual' | 'off';
        effectiveSource: 'session' | 'override' | 'profile';
        sessionOverride: 'auto' | 'manual' | 'off' | null;
        sharedOverride: 'auto' | 'manual' | 'off' | null;
        profileDefault: 'auto' | 'manual' | 'off';
        /**
         * Present ONLY while a mode transition is not converged: the advertised
         * effectiveMode still reflects the source layers, but live capabilities
         * have not (or cannot) converge to it. pending: true means the system
         * is in an explicit degraded / pending-recovery state and the mutation
         * that caused it ALREADY RETURNED FAILURE - the target mode is never
         * claimed as active. Absent at all other times.
         */
        reconciliation?: {
            pending: true;
            kind: 'source-compensation' | 'capability-degraded';
            /** The mode the agent's capabilities actually implement now, when knowable. */
            activeCapabilityMode?: 'auto' | 'manual' | 'off';
            /** Human-readable provenance (the compensating write error / the degraded registration errors). */
            detail?: string;
        };
    };
    baseline: {
        revision: number;
        status: 'unknown' | 'aligned' | 'drift-pending' | 'baseline-update-pending';
        driftCount: number;
        manualChecks: number;
    };
}
/**
 * Create the management API for one controller instance. `register` mounts
 * the routes on the web server and returns the disposer removing them.
 */
export declare function createManagementApi(controller: RequirementsAlignmentController): {
    register(webServer: WebServerLike): () => void;
};
//# sourceMappingURL=management-api.d.ts.map