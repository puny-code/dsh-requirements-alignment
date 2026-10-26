import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { validateAlignmentMode } from "./types.js";
// ── durable sidecar domain (official @deepseek-ai/dsh-storage-domain) ────────
//
// A separate unit from `requirements_alignment` so the session-mode store's
// lifecycle (open/close) never couples to the alignment-state store's.
const sessionModeRecordSchema = z.object({
    schemaVersion: z.literal(1),
    identity: z.object({
        id: z.string(),
        createdAt: z.number(),
        cwd: z.string().optional()
    }),
    mode: z.union([z.literal('auto'), z.literal('manual'), z.literal('off')])
});
/**
 * The storage-domain spec owning the session-mode sidecar. One table keyed by
 * session id; every record is validated by the zod schema at open and at the
 * durable write boundary.
 */
export const SESSION_MODE_DOMAIN = defineDomain({
    name: 'requirements_alignment_modes',
    version: 1,
    tables: {
        sessions: domainTable(sessionModeRecordSchema)
    }
});
/** In-memory port: durable within one process, lost on process exit. */
export function memorySessionModePort() {
    const records = new Map();
    return {
        persistable: true,
        loadAll: async () => new Map(records),
        put: async (key, record) => {
            records.set(key, record);
        },
        delete: async (key) => {
            records.delete(key);
        },
        dispose: async () => void 0
    };
}
/**
 * Entry-only port: reads always yield nothing and writes throw loudly. Used
 * when no storage-domain service is (or will be) mounted — a mis-composition
 * must surface as a clear persistence error, never as silent live-only state.
 */
export function entryOnlySessionModePort() {
    return {
        persistable: false,
        loadAll: async () => new Map(),
        put: async () => {
            throw new Error('requirements-alignment: cannot persist a session mode override: no storage-domain service is mounted '
                + '(compose @deepseek-ai/dsh-storage, @deepseek-ai/dsh-storage-json and '
                + '@deepseek-ai/dsh-storage-domain into the profile)');
        },
        delete: async () => void 0,
        dispose: async () => void 0
    };
}
/** Open the official storage-domain sidecar and wrap it as a port. */
export async function createDomainSessionModePort(ctx, facility) {
    const domain = await facility.open(SESSION_MODE_DOMAIN);
    const table = domain.table('sessions');
    return {
        persistable: true,
        loadAll: async () => {
            const map = new Map();
            for (const [key, value] of table.entries())
                map.set(key, value);
            return map;
        },
        put: async (key, record) => {
            await table.put(key, record);
        },
        delete: async (key) => {
            await table.delete(key);
        },
        dispose: async () => {
            await domain.close();
        }
    };
}
/** The session's sidecar key (its id string). */
function sessionKey(session) {
    return String(session.id);
}
/** Build the identity binding from a session header (absent fields default). */
function identityFromHeader(header) {
    return {
        id: String(header?.id ?? ''),
        createdAt: header?.createdAt ?? 0,
        ...(header?.cwd === undefined ? {} : { cwd: header.cwd })
    };
}
/** Whether a stored identity belongs to the live session's lifecycle. */
function identityMatches(identity, header) {
    if (identity.id !== String(header?.id ?? ''))
        return false;
    if (identity.createdAt !== (header?.createdAt ?? 0))
        return false;
    return identity.cwd === header?.cwd;
}
/**
 * The per-session mode override authority: durable-first writes, fork
 * inheritance, identity binding, and change notification. Reads are
 * synchronous from the in-memory view; every write goes validate -> durable
 * put -> memory commit.
 */
export class SessionModeStore {
    ctx;
    port;
    logger;
    openPromise;
    disposed = false;
    /** Authoritative in-memory view: session id -> override record. */
    records = new Map();
    /** Change observers (the controller's resync path), keyed by session key. */
    listeners = new Set();
    /** Per-session write chains: mutations of one session never interleave. */
    writeChains = new Map();
    disposeEffect;
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.logger = options.logger;
        this.port = options.port ?? entryOnlySessionModePort();
        // Close the sidecar domain with the plugin fiber.
        this.disposeEffect = ctx.effect(() => () => {
            this.disposed = true;
            for (const chain of this.writeChains.values())
                void chain.catch(() => { });
            this.writeChains.clear();
            this.records.clear();
            this.listeners.clear();
            void this.port.dispose().catch(() => { });
        });
    }
    /** Whether writes currently reach a durable medium. */
    get persistable() {
        return this.port.persistable;
    }
    /** The open/attach completion (resolves when the initial port is settled). */
    get ready() {
        return this.openPromise ?? Promise.resolve();
    }
    /**
     * Open the store: when `ctx.storageDomain` is already mounted, open the
     * sidecar domain and load every record before resolving; otherwise stay
     * entry-only and attach via `ctx.inject` the moment the service appears.
     * Idempotent. Called from the plugin's awaited `[Service.init]`, so by the
     * time any session exists the durable view is loaded.
     */
    open() {
        if (this.openPromise === undefined) {
            this.openPromise = this.openCore();
        }
        return this.openPromise;
    }
    async openCore() {
        const facility = this.ctx.get('storageDomain');
        if (facility !== undefined) {
            await this.attachDomain(facility);
            return;
        }
        // No domain facility mounted (yet): load whatever the current port
        // holds, then upgrade the moment the official service appears.
        await this.loadFromPort();
        this.ctx.inject(['storageDomain'], (sctx) => {
            void this.attachDomain(sctx.storageDomain);
        });
    }
    /** Load every record from the current port into the in-memory view. */
    async loadFromPort() {
        const loaded = await this.port.loadAll();
        this.records.clear();
        for (const [key, record] of loaded)
            this.records.set(key, record);
    }
    /** Swap in the durable port once the domain opens; errors degrade loudly. */
    async attachDomain(facility) {
        if (this.disposed)
            return;
        try {
            const durable = await createDomainSessionModePort(this.ctx, facility);
            if (this.disposed) {
                await durable.dispose().catch(() => { });
                return;
            }
            this.port = durable;
            await this.loadFromPort();
        }
        catch (error) {
            this.logger?.warn('requirements-alignment: failed to open the session-mode sidecar; session mode overrides are not durable: %o', error);
        }
    }
    // ── reads (synchronous, authoritative in-memory view) ────────────────────
    /**
     * The session-scoped mode override in force for one session, when any.
     * Identity-bound: a record from a different lifecycle (a reused session id)
     * is shadowed and never returned.
     */
    getOverride(session) {
        const record = this.lookupRecord(sessionKey(session), session);
        return record?.mode;
    }
    /** Whether one session carries a session-scoped override record. */
    hasRecord(session) {
        return this.lookupRecord(sessionKey(session), session) !== undefined;
    }
    // ── mutations (durable-first) ────────────────────────────────────────────
    /**
     * Persist a session-scoped override. Validated before any write; a port
     * without a durable medium rejects. After the write, observers are notified
     * (the controller resyncs that session's agent).
     */
    async setOverride(session, mode) {
        validateAlignmentMode(mode);
        const key = sessionKey(session);
        await this.enqueue(key, async () => {
            const record = {
                schemaVersion: 1,
                identity: identityFromHeader(session.header),
                mode
            };
            await this.port.put(key, record); // durable first
            this.records.set(key, record); // memory commit
        });
        this.notify(key);
    }
    /**
     * Remove the session-scoped override; the session returns to the shared
     * layers. A no-op when no record exists. Observers are notified after a
     * successful clear.
     */
    async clearOverride(session) {
        const key = sessionKey(session);
        const cleared = await this.enqueue(key, async () => {
            const record = this.lookupRecord(key, session);
            if (record === undefined)
                return false;
            await this.port.delete(key); // durable first
            this.records.delete(key); // memory commit
            return true;
        });
        if (cleared)
            this.notify(key);
    }
    // ── adoption / migration ─────────────────────────────────────────────────
    /**
     * Adopt one session into the store: a fork child inherits the parent's
     * override (one-time copy) when the parent has one, and the change
     * notifies observers so the controller can re-sync the child's agent to
     * the inherited mode. Idempotent — a session with a record is left
     * untouched, and a fresh session without a parent record creates nothing
     * (it inherits the shared layers).
     */
    async initializeSession(session) {
        const key = sessionKey(session);
        const inherited = await this.enqueue(key, async () => {
            if (this.records.has(key))
                return false;
            const derived = this.derivedRecord(session);
            if (derived === undefined)
                return false;
            await this.port.put(key, derived);
            this.records.set(key, derived);
            return true;
        });
        if (inherited)
            this.notify(key);
    }
    /** Adopt a fork child specifically (same idempotent path). */
    initializeFork(session) {
        return this.initializeSession(session);
    }
    // ── subscription ─────────────────────────────────────────────────────────
    /**
     * Observe session-mode changes (a set or clear committed). The listener
     * receives the session key of the affected session, so the controller can
     * resync exactly that agent. Returns a disposer; no initial callback fires.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    // ── internals ────────────────────────────────────────────────────────────
    /** Serialize one session's store operations (adoption + mutations). */
    enqueue(key, task) {
        const previous = this.writeChains.get(key) ?? Promise.resolve();
        const next = previous.then(task, task);
        this.writeChains.set(key, next.catch(() => { }));
        return next;
    }
    notify(key) {
        if (this.disposed)
            return;
        for (const listener of [...this.listeners]) {
            try {
                listener(key);
            }
            catch (error) {
                this.logger?.warn('requirements-alignment: session-mode change listener failed: %o', error);
            }
        }
    }
    /** The record in force for a session, with identity binding. */
    lookupRecord(key, session) {
        const record = this.records.get(key);
        if (record === undefined)
            return undefined;
        if (identityMatches(record.identity, session.header))
            return record;
        // Stale record left by a previous lifecycle reusing this id: SHADOW it
        // (never honor it for the new lifecycle). The record is kept so a later
        // read by the ORIGINAL lifecycle still resolves; the new lifecycle's
        // next mutation overwrites it with the new identity.
        return undefined;
    }
    /**
     * The record that SHOULD exist for a session before any explicit mutation:
     * a fork child inherits the parent's override; fresh sessions have nothing
     * to materialize.
     */
    derivedRecord(session) {
        const header = session.header;
        if (header?.parentSession === undefined)
            return undefined;
        const parentRecord = this.records.get(String(header.parentSession));
        if (parentRecord === undefined)
            return undefined;
        return {
            schemaVersion: 1,
            identity: identityFromHeader(header),
            mode: parentRecord.mode
        };
    }
}
export default SessionModeStore;
//# sourceMappingURL=session-mode-store.js.map