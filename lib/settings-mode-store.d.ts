/**
 * The DSH Settings-backed ModeStore port.
 *
 * Current DSH 0.1.7 persistence: SettingsForms describes the owning loader
 * entry (matched by fiber uid), and ConfigEditor persists runtimeMode in its
 * profile configuration. Missing/null means inherit the live mode default.
 * Revision-checked mutations preserve unrelated fields; reset writes null.
 * The legacy adapter below exists only for historical regression fixtures,
 * not as a claim of compatibility with older hosts.
 *
 * Historical fixture persistence model:
 *
 *   resolved = schema( defaults + composition base + user document section )
 *
 * - `base` carries the profile default (`config.mode`) — the composition
 *   layer, exactly what the entry config owns. The user document section
 *   (`settings.yaml`, hot-reloaded by the file provider) is the persisted
 *   override layer. `replace({})` is the reset path: it removes the user
 *   section and re-inherits the base.
 * - The storage schema is deliberately permissive (`Schema.any()`): an
 *   invalid stored override must NOT fail plugin startup (a strict schema
 *   path would reject the registration itself). ModeStore owns strict
 *   validation and repairs the document when it detects an invalid override.
 * - Change observation rides the scope `watch` (resolved-value changes) plus
 *   the provider's `settings/document-updated` event (raw-section changes,
 *   which fire even when an override equals the base).
 *
 * Ownership: `settings.register()` is an effect on the *calling* fiber
 * (Cordis service context tracing), and the watchers/event listener are
 * `ctx.effect` entries on the plugin fiber, so the namespace registration
 * and its observers all die with the plugin — no orphan registrations
 * survive an unload.
 *
 * Attach strategy: `ctx.get('settings')` reads the service synchronously
 * when it is already running (the shipped web profile starts the settings
 * row before plugin rows), so the startup snapshot includes a persisted
 * override immediately. When the service is absent or starts later, the
 * `ctx.inject` fallback attaches the moment it becomes available, and a
 * provider reload re-attaches because the dependent fiber re-runs.
 *
 * @module dsh-requirements-alignment/settings-mode-store
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import Schema from '@deepseek-ai/schemastery';
import { ModeStore, type ModeStorePort, type ModeStoreRead } from './mode-store.ts';
import type { AlignmentMode } from './types.ts';
/** Lowercase kebab-case namespace owned by this plugin (pattern-checked at brand time). */
export declare const SETTINGS_NAMESPACE: SettingsNamespace;
/**
 * Permissive storage schema. The settings layer must never reject a stored
 * section — a strict enum schema would fail the registration itself on an
 * invalid stored override and take the plugin down (v0.3.0 rule: an invalid
 * override must never fail startup). ModeStore validates on read and repairs.
 */
export declare const MODE_SETTINGS_SCHEMA: Schema<any, any, "plain">;
/**
 * ModeStorePort over the DSH Settings service. Read-only on the raw document,
 * writes go through the registered scope; `persistable` flips true once the
 * settings service is attached.
 */
export declare class SettingsModeStorePort implements ModeStorePort {
    private readonly ctx;
    private readonly defaultMode;
    private provider;
    private scope;
    private changeCallback;
    private disposed;
    constructor(ctx: Context, defaultMode: AlignmentMode);
    /** Whether the settings service is attached and writes can persist. */
    get persistable(): boolean;
    /** Attach to the settings service, synchronously or via inject. */
    attach(): void;
    read(): ModeStoreRead;
    writeOverride(mode: AlignmentMode): Promise<void>;
    clearOverride(): Promise<void>;
    watch(callback: () => void): () => void;
    dispose(): void;
    private attachProvider;
    private requireScope;
    private descriptor;
    private requireDescriptor;
    private userSectionHasMode;
    private onChange;
}
/**
 * Create the runtime ModeStore over the DSH Settings service with the
 * profile default as the base layer. Falls back to entry-only when no
 * settings service is (or will be) mounted.
 */
export declare function createModeStore(ctx: Context, entry: {
    mode: AlignmentMode;
}, logger?: {
    warn(message?: string, ...optionalParams: unknown[]): void;
}): ModeStore;
export default SettingsModeStorePort;
//# sourceMappingURL=settings-mode-store.d.ts.map