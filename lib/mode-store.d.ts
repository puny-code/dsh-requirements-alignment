/**
 * ModeStore: the single authority over the runtime alignment mode.
 *
 * v0.3.0 introduces a three-layer mode model in place of the static
 * `config.mode`:
 *
 *   valid persisted override  ->  valid profile default  ->  auto
 *
 * `defaultMode` is the composition/profile value (`config.mode`, `auto` when
 * absent). `overrideMode` is the user-persisted value when one exists and is
 * valid. The effective mode is `overrideMode ?? defaultMode`, and
 * `effectiveSource` reports which layer produced it. No other module computes
 * the effective mode — ModeStore is the single source of truth.
 *
 * ModeStore is deliberately split from capability registration:
 *
 *   ModeStore              -> desired/effective configuration
 *   RuntimeModeController  -> register/dispose actual DSH capabilities
 *
 * ModeStore never registers or disposes capabilities; it only resolves,
 * persists, and notifies. Persistence goes through a {@link ModeStorePort} so
 * the store stays pure and testable; the shipped port is the DSH Settings
 * service (`src/settings-mode-store.ts`), and an entry-only port carries
 * deployments without a settings service.
 *
 * Validation rules:
 * - `setOverride` validates BEFORE any write; an invalid mode is rejected and
 *   never persisted.
 * - A stored override that fails validation (for example a hand-edited
 *   document) never fails the plugin: ModeStore falls back to the profile
 *   default, logs a diagnostic, and repairs the document once (idempotent).
 *
 * @module dsh-requirements-alignment/mode-store
 */
import { type AlignmentMode } from './types.ts';
/** Where the effective mode comes from. */
export type EffectiveSource = 'profile' | 'override';
/** Full resolved picture of the runtime mode at one moment. */
export interface ModeSnapshot {
    /** The composition/profile default (`config.mode`, `auto` when absent). */
    defaultMode: AlignmentMode;
    /** The valid user-persisted override, when one exists. */
    overrideMode?: AlignmentMode;
    /** `overrideMode` when present, otherwise `defaultMode`. */
    effectiveMode: AlignmentMode;
    /** Which layer produced `effectiveMode`. */
    effectiveSource: EffectiveSource;
}
/** What the persistence layer reports for one read. */
export interface ModeStoreRead {
    /** Modern profile configurations expose the inherited base separately. */
    defaultMode?: unknown;
    /** The mode value as stored/resolved, unvalidated (may be junk). */
    resolvedMode: unknown;
    /** Whether the raw user layer currently holds a `mode` field. */
    userHasMode: boolean;
}
/** Diagnostic sink kept deliberately minimal (Cordis Logger is compatible). */
export interface ModeStoreLogger {
    warn(message?: string, ...optionalParams: unknown[]): void;
}
/**
 * Persistence seam for the mode override. The shipped implementation wraps
 * the DSH Settings service; tests use an in-memory port with the same
 * semantics (base layer + user layer + change observation).
 */
export interface ModeStorePort {
    /** Whether an override can be persisted right now (settings attached). */
    readonly persistable: boolean;
    /** Live read of the storage layer. */
    read(): ModeStoreRead;
    /** Persist a validated override. */
    writeOverride(mode: AlignmentMode): Promise<void>;
    /** Remove the override (no-op when none exists). */
    clearOverride(): Promise<void>;
    /** Observe any change that may alter the snapshot; returns a disposer. */
    watch(callback: () => void): () => void;
    /** Release port-owned resources; idempotent. */
    dispose(): void;
}
/**
 * A port that never persists: the profile default is the only source. Used
 * when no settings service is mounted (headless tests, minimal profiles).
 */
export declare function entryModeStorePort(defaultMode: AlignmentMode): ModeStorePort;
/**
 * The runtime mode authority: resolution, validation, persistence, reset, and
 * change notification. Pure over its {@link ModeStorePort}; never touches
 * registries or capabilities.
 */
export declare class ModeStore {
    private readonly port;
    private readonly defaultMode;
    private readonly logger;
    private readonly listeners;
    private readonly portWatchDisposer;
    /** The snapshot established at construction; the `previous` of the first change. */
    private lastSnapshot;
    private invalidRepairScheduled;
    private disposed;
    constructor(port: ModeStorePort, defaultMode: AlignmentMode, logger?: ModeStoreLogger);
    /**
     * Resolve the current snapshot. Live read: the port is consulted on every
     * call, so externally edited documents (hot reload) are reflected without
     * waiting for a notification.
     */
    getSnapshot(): ModeSnapshot;
    private resolveSnapshot;
    /**
     * Persist a validated override. Rejects an invalid mode before any write;
     * the port's `persistable` gate rejects writes when no settings service is
     * attached. After the write the snapshot is re-read and subscribers are
     * notified (the port's own async notification deduplicates).
     */
    setOverride(mode: AlignmentMode): Promise<void>;
    /**
     * Remove the override; the effective mode returns to the profile default.
     * A no-op on ports without an override to clear.
     */
    resetOverride(): Promise<void>;
    /**
     * Observe mode changes. The listener receives the next and previous
     * snapshots; it is only invoked when the snapshot actually changed.
     * Returns a disposer; no initial callback fires (read `getSnapshot()` for
     * the current value).
     */
    subscribe(listener: (next: ModeSnapshot, previous: ModeSnapshot) => void): () => void;
    /** Release the port watch and all listeners; idempotent. */
    dispose(): void;
    private onPortChange;
    private notify;
    /**
     * One-shot repair of an invalid stored override: fall back to the profile
     * default (already reflected in {@link getSnapshot}) and clear the invalid
     * document section so it stops persisting. Idempotent — a repeated invalid
     * read after a successful repair does not rewrite anything.
     */
    private scheduleInvalidRepair;
}
export default ModeStore;
//# sourceMappingURL=mode-store.d.ts.map