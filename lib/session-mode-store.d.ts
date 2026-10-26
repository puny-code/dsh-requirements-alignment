/**
 * SessionModeStore: the durable, per-session alignment-mode override.
 *
 * v0.4.0 introduces a fourth layer to the runtime mode model:
 *
 *   valid session override  ->  valid persisted runtime override
 *                            ->  valid profile default  ->  auto
 *
 * SessionModeStore owns the FIRST layer: one override per session lifecycle
 * identity (id + createdAt + cwd), persisted to its own storage-domain unit
 * (`requirements_alignment_modes`). A session without a record inherits the
 * shared layers (the ModeStore). ModeStore and SessionModeStore are
 * deliberately split: the shared layer persists through the DSH Settings
 * service, the session layer through the durable sidecar — switching one
 * never touches the other, and resetting the shared override never deletes a
 * session override (the v0.3.0 state-preservation guarantee extends to the
 * new layer).
 *
 * Identity binding (the same rule as AlignmentStateStore): a stored record is
 * only honored when its identity matches the live session's header, so a
 * deleted session whose id is later reused can never leak a stale override
 * into the new session.
 *
 * Durable-first writes (the same contract as AlignmentStateStore):
 * validate -> durable put -> memory commit; a failed durable write leaves the
 * in-memory view untouched and surfaces to the caller.
 *
 * Fork inheritance: a fork child adopts the parent's override (a one-time
 * copy) at session-start, then becomes independently changeable. A parent
 * without a record leaves the child without one (it inherits the shared
 * layers).
 *
 * @module dsh-requirements-alignment/session-mode-store
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { AlignmentSessionLike } from './alignment-state-store.ts';
import { type AlignmentMode } from './types.ts';
/** The identity binding of one session-mode record (the session lifecycle it belongs to). */
export interface SessionModeIdentity {
    /** The session id. */
    id: string;
    /** The session's `createdAt` from its header (0 when the header is absent). */
    createdAt: number;
    /** The session's `cwd` from its header, when any. */
    cwd?: string;
}
/** One durable session-mode record: identity + the override mode. */
export interface SessionModeRecord {
    /** Sidecar schema version (this build writes 1). */
    schemaVersion: 1;
    /** The session lifecycle this override belongs to. */
    identity: SessionModeIdentity;
    /** The session-scoped mode override. */
    mode: AlignmentMode;
}
/** Minimal diagnostic sink (Cordis Logger is compatible). */
export interface SessionModeLogger {
    warn(message?: string, ...optionalParams: unknown[]): void;
}
/**
 * The storage-domain spec owning the session-mode sidecar. One table keyed by
 * session id; every record is validated by the zod schema at open and at the
 * durable write boundary.
 */
export declare const SESSION_MODE_DOMAIN: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, SessionModeRecord>;
    };
};
/** The durable medium abstraction of the store (domain-backed or in-memory). */
export interface SessionModePort {
    /** Whether writes reach a durable medium (false = entry-only). */
    readonly persistable: boolean;
    /** Load every stored record. */
    loadAll(): Promise<ReadonlyMap<string, SessionModeRecord>>;
    /** Durably upsert one record; resolves only after durability. */
    put(key: string, record: SessionModeRecord): Promise<void>;
    /** Durably remove one record; a no-op when absent. */
    delete(key: string): Promise<void>;
    /** Release port-owned resources; idempotent. */
    dispose(): Promise<void>;
}
/** In-memory port: durable within one process, lost on process exit. */
export declare function memorySessionModePort(): SessionModePort;
/**
 * Entry-only port: reads always yield nothing and writes throw loudly. Used
 * when no storage-domain service is (or will be) mounted — a mis-composition
 * must surface as a clear persistence error, never as silent live-only state.
 */
export declare function entryOnlySessionModePort(): SessionModePort;
/** Open the official storage-domain sidecar and wrap it as a port. */
export declare function createDomainSessionModePort(ctx: Context, facility: DomainFacility): Promise<SessionModePort>;
/** Store options. */
export interface SessionModeStoreOptions {
    /** Explicit port (tests). Defaults to entry-only + storage-domain attach. */
    port?: SessionModePort;
    /** Diagnostic sink. */
    logger?: SessionModeLogger;
}
/**
 * The per-session mode override authority: durable-first writes, fork
 * inheritance, identity binding, and change notification. Reads are
 * synchronous from the in-memory view; every write goes validate -> durable
 * put -> memory commit.
 */
export declare class SessionModeStore {
    private readonly ctx;
    private port;
    private readonly logger;
    private openPromise;
    private disposed;
    /** Authoritative in-memory view: session id -> override record. */
    private readonly records;
    /** Change observers (the controller's resync path), keyed by session key. */
    private readonly listeners;
    /** Per-session write chains: mutations of one session never interleave. */
    private readonly writeChains;
    private readonly disposeEffect;
    constructor(ctx: Context, options?: SessionModeStoreOptions);
    /** Whether writes currently reach a durable medium. */
    get persistable(): boolean;
    /** The open/attach completion (resolves when the initial port is settled). */
    get ready(): Promise<void>;
    /**
     * Open the store: when `ctx.storageDomain` is already mounted, open the
     * sidecar domain and load every record before resolving; otherwise stay
     * entry-only and attach via `ctx.inject` the moment the service appears.
     * Idempotent. Called from the plugin's awaited `[Service.init]`, so by the
     * time any session exists the durable view is loaded.
     */
    open(): Promise<void>;
    private openCore;
    /** Load every record from the current port into the in-memory view. */
    private loadFromPort;
    /** Swap in the durable port once the domain opens; errors degrade loudly. */
    private attachDomain;
    /**
     * The session-scoped mode override in force for one session, when any.
     * Identity-bound: a record from a different lifecycle (a reused session id)
     * is shadowed and never returned.
     */
    getOverride(session: AlignmentSessionLike): AlignmentMode | undefined;
    /** Whether one session carries a session-scoped override record. */
    hasRecord(session: AlignmentSessionLike): boolean;
    /**
     * Persist a session-scoped override. Validated before any write; a port
     * without a durable medium rejects. After the write, observers are notified
     * (the controller resyncs that session's agent).
     */
    setOverride(session: AlignmentSessionLike, mode: AlignmentMode): Promise<void>;
    /**
     * Remove the session-scoped override; the session returns to the shared
     * layers. A no-op when no record exists. Observers are notified after a
     * successful clear.
     */
    clearOverride(session: AlignmentSessionLike): Promise<void>;
    /**
     * Adopt one session into the store: a fork child inherits the parent's
     * override (one-time copy) when the parent has one, and the change
     * notifies observers so the controller can re-sync the child's agent to
     * the inherited mode. Idempotent — a session with a record is left
     * untouched, and a fresh session without a parent record creates nothing
     * (it inherits the shared layers).
     */
    initializeSession(session: AlignmentSessionLike): Promise<void>;
    /** Adopt a fork child specifically (same idempotent path). */
    initializeFork(session: AlignmentSessionLike): Promise<void>;
    /**
     * Observe session-mode changes (a set or clear committed). The listener
     * receives the session key of the affected session, so the controller can
     * resync exactly that agent. Returns a disposer; no initial callback fires.
     */
    subscribe(listener: (key: string) => void): () => void;
    /** Serialize one session's store operations (adoption + mutations). */
    private enqueue;
    private notify;
    /** The record in force for a session, with identity binding. */
    private lookupRecord;
    /**
     * The record that SHOULD exist for a session before any explicit mutation:
     * a fork child inherits the parent's override; fresh sessions have nothing
     * to materialize.
     */
    private derivedRecord;
}
export default SessionModeStore;
//# sourceMappingURL=session-mode-store.d.ts.map