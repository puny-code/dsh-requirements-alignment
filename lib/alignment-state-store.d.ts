/**
 * AlignmentStateStore: the canonical, durable Requirements Alignment state.
 *
 * Architecture (the persistence-compatibility fix):
 *
 *   DSH Session log                 — official DSH events ONLY; this plugin
 *                                     never appends `alignment/*` events again.
 *   AlignmentStateStore sidecar     — whole-state checkpoints
 *                                     `{ visibleThroughSeq, state }` per
 *                                     session, stored in the official
 *                                     `ctx.storageDomain` KV domain, keyed by
 *                                     session id with lifecycle identity
 *                                     binding (id + createdAt + cwd).
 *
 * Durability contract (durable-first):
 *
 *   validate -> durable write (port.put) -> memory commit -> return success.
 *   A failed durable write leaves the in-memory view untouched and surfaces
 *   to the caller — the live view can never diverge from the medium.
 *
 * Historical fork:
 *
 *   Every mutation appends one whole-state checkpoint bound to the session
 *   log length at commit time. `stateAt(boundary)` — used for fork
 *   inheritance at the official `header.seedLength - 1` boundary — returns
 *   the last checkpoint with `visibleThroughSeq <= boundary`, so forking a
 *   parent at an OLD completed-turn boundary inherits the state that was in
 *   force then, never the parent's latest.
 *
 * Session identity:
 *
 *   A stored record is only honored when its identity (id + createdAt + cwd
 *   from the creating session's header) matches the live session's header, so
 *   a deleted session whose id is later reused can never leak stale
 *   alignment state into the new session.
 *
 * Legacy compatibility:
 *
 *   The legacy fold functions stay the compatibility layer. Sessions whose
 *   log still carries legacy `alignment/*` events are folded into the
 *   checkpoint timeline on first adoption (`importLegacyTimeline`) —
 *   idempotently, one checkpoint per legacy mutation, so historical forks of
 *   migrated sessions resolve exactly like the fold would.
 *
 * @module dsh-requirements-alignment/alignment-state-store
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId, SessionHeader } from '@deepseek-ai/dsh-session';
import { type SessionEventSource } from './session-events.ts';
import { type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { type AlignmentCheckpoint } from './alignment-state.ts';
import { type AlignmentDecisionKind, type AlignmentStatus, type DriftReason, type RequirementBaseline } from './types.ts';
/** The identity binding of one sidecar record (the session lifecycle it belongs to). */
export interface AlignmentSessionIdentity {
    /** The session id. */
    id: string;
    /** The session's `createdAt` from its header (0 when the header is absent). */
    createdAt: number;
    /** The session's `cwd` from its header, when any. */
    cwd?: string;
}
/** Fork lineage recorded on a child record (official header lineage). */
export interface AlignmentInheritedFrom {
    /** The parent session id (`header.parentSession`). */
    parentSession: string;
    /** The inclusive parent seq the child inherited through (`header.seedLength - 1`). */
    boundarySeq: number;
    /** The official inherited prefix length (`header.seedLength`). */
    seedLength: number;
}
/** One durable sidecar record: identity + whole-state checkpoint timeline. */
export interface AlignmentSessionRecord {
    /** Sidecar schema version (this build writes 1). */
    schemaVersion: 1;
    /** The session lifecycle this state belongs to. */
    identity: AlignmentSessionIdentity;
    /** Ascending whole-state checkpoints. */
    checkpoints: AlignmentCheckpoint[];
    /** Fork lineage, when this session was forked from another. */
    inheritedFrom?: AlignmentInheritedFrom;
    /** Legacy timeline import marker ('v0.1'/'v0.2'), when imported. */
    migratedFrom?: 'v0.1' | 'v0.2';
    /** Epoch ms of the legacy timeline import. */
    migratedAt?: number;
}
/** The session surface the store needs (a real `Session` or a test double). */
export interface AlignmentSessionLike extends SessionEventSource {
    readonly id: SessionId;
    readonly header?: SessionHeader;
    readonly seq: number;
    /** DSH 0.1.3+ stores the exact inherited prefix on Session, not its header. */
    readonly inheritedEventCount?: number;
}
/** Minimal diagnostic sink (Cordis Logger is compatible). */
export interface AlignmentStateLogger {
    warn(message?: string, ...optionalParams: unknown[]): void;
}
/**
 * The storage-domain spec owning the alignment sidecar. Name follows
 * `UNIT_NAME_RE` (lowercase start, then `[a-z0-9_]`). One table keyed by
 * session id; every record is validated by the zod schema at open and at the
 * durable write boundary.
 */
export declare const ALIGNMENT_STATE_DOMAIN: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, AlignmentSessionRecord>;
    };
};
/** The durable medium abstraction of the store (domain-backed or in-memory). */
export interface AlignmentStatePort {
    /** Whether writes reach a durable medium (false = entry-only). */
    readonly persistable: boolean;
    /** Load every stored record. */
    loadAll(): Promise<ReadonlyMap<string, AlignmentSessionRecord>>;
    /** Durably upsert one record; resolves only after durability. */
    put(key: string, record: AlignmentSessionRecord): Promise<void>;
    /** Release port-owned resources; idempotent. */
    dispose(): Promise<void>;
}
/**
 * In-memory port: durable within one process (survives store recreation,
 * which is what unit tests and in-process reloads need), lost on process
 * exit. The explicit test/dev port.
 */
export declare function memoryAlignmentStatePort(): AlignmentStatePort;
/**
 * Entry-only port: reads always yield nothing and writes throw loudly. Used
 * when no storage-domain service is (or will be) mounted — a mis-composition
 * must surface as a clear persistence error, never as silent live-only state
 * (the durable-first contract).
 */
export declare function entryOnlyAlignmentStatePort(): AlignmentStatePort;
/**
 * Open the official storage-domain sidecar and wrap it as a port. The domain
 * layer itself is durable-first (backend write resolves before its in-memory
 * state mutates), which is exactly the write ordering the store requires.
 */
export declare function createDomainAlignmentStatePort(ctx: Context, facility: DomainFacility): Promise<AlignmentStatePort>;
/** Store options. */
export interface AlignmentStateStoreOptions {
    /** Explicit port (tests). Defaults to entry-only + storage-domain attach. */
    port?: AlignmentStatePort;
    /** Diagnostic sink. */
    logger?: AlignmentStateLogger;
}
/**
 * The canonical alignment state authority: per-session in-memory view,
 * durable-first mutations, fork inheritance, legacy import. Reads are
 * synchronous from the in-memory view (hot paths never touch the medium);
 * every write goes validate -> durable put -> memory commit.
 */
export declare class AlignmentStateStore {
    private readonly ctx;
    private port;
    private readonly logger;
    private openPromise;
    private disposed;
    /** Authoritative in-memory view: session id -> sidecar record. */
    private readonly records;
    /**
     * Derived public status per session (the sync read path), bound to the
     * lifecycle identity (id + createdAt + cwd) that produced it, so a session
     * id reused by a different lifecycle can never hit a stale cached status.
     * A cache entry is only a hit when its identity matches the live session's
     * header under the same rule the record lookup uses (`identityMatches`).
     */
    private readonly statusCache;
    /** Per-session write chains: mutations of one session never interleave. */
    private readonly writeChains;
    private readonly disposeEffect;
    constructor(ctx: Context, options?: AlignmentStateStoreOptions);
    /** Whether writes currently reach a durable medium. */
    get persistable(): boolean;
    /** The open/attach completion (resolves when the initial port is settled). */
    get ready(): Promise<void>;
    /**
     * Open the store: when `ctx.storageDomain` is already mounted (the
     * shipped web profile), open the sidecar domain and load every record
     * before resolving; otherwise stay entry-only and attach via `ctx.inject`
     * the moment the service appears. Idempotent. Called from the plugin's
     * awaited `[Service.init]`, so by the time any session exists the durable
     * view is loaded.
     */
    open(): Promise<void>;
    private openCore;
    /** Load every record from the current port into the in-memory view. */
    private loadFromPort;
    /** Swap in the durable port once the domain opens; errors degrade loudly. */
    private attachDomain;
    /**
     * The folded alignment status of one session. Synchronous: reads the
     * in-memory view; resolves sidecar records, fork lineage, and legacy
     * folds without touching the medium.
     */
    getStatus(session: AlignmentSessionLike): AlignmentStatus;
    /** The baseline in force for one session, when any. */
    getBaseline(session: AlignmentSessionLike): RequirementBaseline | undefined;
    /**
     * The alignment status in force at a historical log boundary (e.g. a
     * fork's `seedLength - 1`). The historical-fork verification surface.
     */
    getStatusAtBoundary(session: AlignmentSessionLike, boundary: number): AlignmentStatus;
    /** Record (or replace) the whole-value baseline at the current log length. */
    recordBaseline(session: AlignmentSessionLike, baseline: RequirementBaseline): Promise<void>;
    /**
     * Record one drift candidate at the current log length and return its
     * pairing key (the checkpoint's `visibleThroughSeq`), which the later
     * decision must reference.
     */
    recordDrift(session: AlignmentSessionLike, data: {
        reason: DriftReason;
        description: string;
        requiredChange?: string;
        at: number;
    }): Promise<{
        driftSeq: number;
    }>;
    /** Record one user decision on a drift candidate at the current log length. */
    recordDecision(session: AlignmentSessionLike, data: {
        driftSeq: number;
        decision: AlignmentDecisionKind;
        note?: string;
        at: number;
    }): Promise<void>;
    /** Record one manual `/align` inspection at the current log length. */
    recordManualCheck(session: AlignmentSessionLike, at?: number): Promise<void>;
    /**
     * Adopt one session into the store: materialize the sidecar record for
     * fork children (pin the inherited state at the official `seedLength - 1`
     * boundary) and for legacy sessions (import the folded timeline).
     * Idempotent — a session with a record is left untouched, so repeated
     * adoption never duplicates state or doubles counters. Fresh new-style
     * sessions create no record until their first mutation.
     */
    initializeSession(session: AlignmentSessionLike): Promise<void>;
    /** Adopt a fork child specifically (same idempotent path). */
    initializeFork(session: AlignmentSessionLike): Promise<void>;
    /**
     * Explicitly import a legacy session's alignment timeline into the
     * sidecar (fold -> one checkpoint per legacy mutation). Idempotent.
     */
    importLegacyTimeline(session: AlignmentSessionLike): Promise<void>;
    /** Serialize one session's store operations (adoption + mutations). */
    private enqueue;
    /**
     * One durable-first mutation: derive -> durable put -> memory commit.
     * The commit boundary is the session's official log length at mutation
     * time (inside the per-session write chain, so it never races other
     * store operations for the same session); the ORDERING key handed to the
     * transition is a per-session monotonic mutation counter, so two
     * mutations recorded at the same log length still order correctly.
     *
     * @returns the commit boundary (`visibleThroughSeq` of the new checkpoint).
     */
    private mutate;
    /** The record in force for a session, with identity binding. */
    private lookupRecord;
    /** The current snapshot for a session (record -> lineage -> legacy fold -> empty). */
    private currentSnapshot;
    /** The record base for a session: existing record, or derived, or fresh. */
    private baseRecordFor;
    /**
     * Derive the record that SHOULD exist for a session before any mutation:
     * fork children inherit the parent's state at the official
     * `seedLength - 1` boundary; legacy sessions fold their timeline;
     * fresh new-style sessions have nothing to materialize.
     */
    private derivedBaseRecord;
    /**
     * The parent's alignment state at a boundary: the parent's sidecar record
     * when one exists, otherwise the child's own seed prefix folded through
     * the legacy compatibility layer (a legacy parent — or a parent that was
     * never adopted — has no record, and the child's seed IS the parent's
     * prefix, so the fold is exact).
     */
    private resolveParentState;
}
export default AlignmentStateStore;
//# sourceMappingURL=alignment-state-store.d.ts.map