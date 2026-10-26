import Schema from '@deepseek-ai/schemastery';
import { ModeStore } from "./mode-store.js";
/** Lowercase kebab-case namespace owned by this plugin (pattern-checked at brand time). */
// Legacy fixture namespace. Modern profiles use the owning loader entry id.
export const SETTINGS_NAMESPACE = 'requirements-alignment';
/**
 * Permissive storage schema. The settings layer must never reject a stored
 * section — a strict enum schema would fail the registration itself on an
 * invalid stored override and take the plugin down (v0.3.0 rule: an invalid
 * override must never fail startup). ModeStore validates on read and repairs.
 */
export const MODE_SETTINGS_SCHEMA = Schema.any();
/** Whether a value is a plain record (the only shape a mode section can be). */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * ModeStorePort over the DSH Settings service. Read-only on the raw document,
 * writes go through the registered scope; `persistable` flips true once the
 * settings service is attached.
 */
export class SettingsModeStorePort {
    ctx;
    defaultMode;
    provider;
    scope;
    changeCallback;
    disposed = false;
    constructor(ctx, defaultMode) {
        this.ctx = ctx;
        this.defaultMode = defaultMode;
    }
    /** Whether the settings service is attached and writes can persist. */
    get persistable() {
        if (this.provider !== undefined && !('register' in this.provider)) {
            return this.provider.writable && this.descriptor() !== undefined;
        }
        return this.scope !== undefined;
    }
    /** Attach to the settings service, synchronously or via inject. */
    attach() {
        if (this.disposed)
            return;
        const provider = this.ctx.get('settings');
        if (provider !== undefined) {
            this.attachProvider(provider);
            return;
        }
        this.ctx.inject(['settings'], (sctx) => {
            if (this.disposed)
                return;
            this.attachProvider(sctx.settings);
        });
    }
    read() {
        if (this.provider !== undefined && !('register' in this.provider)) {
            const descriptor = this.descriptor();
            if (descriptor === undefined)
                return { resolvedMode: this.defaultMode, userHasMode: false };
            return {
                resolvedMode: isRecord(descriptor.value) ? descriptor.value.runtimeMode : undefined,
                userHasMode: isRecord(descriptor.value) && descriptor.value.runtimeMode != null,
                defaultMode: isRecord(descriptor.value) ? descriptor.value.mode : this.defaultMode
            };
        }
        const scope = this.scope;
        if (scope === undefined) {
            return { resolvedMode: this.defaultMode, userHasMode: false };
        }
        const resolved = scope.get();
        return {
            resolvedMode: isRecord(resolved) ? resolved.mode : undefined,
            userHasMode: this.userSectionHasMode()
        };
    }
    async writeOverride(mode) {
        if (this.provider !== undefined && !('register' in this.provider)) {
            const descriptor = this.requireDescriptor();
            await this.provider.mutate(descriptor.ns, [{ op: 'set', path: ['runtimeMode'], value: mode }], descriptor.revision);
            return;
        }
        const scope = this.requireScope();
        await scope.update({ mode });
    }
    async clearOverride() {
        if (this.provider !== undefined && !('register' in this.provider)) {
            const descriptor = this.requireDescriptor();
            // A neutral value is durable even when other config fields are
            // overridden; native ConfigEditor writes complete config objects.
            await this.provider.mutate(descriptor.ns, [{ op: 'set', path: ['runtimeMode'], value: null }], descriptor.revision);
            return;
        }
        if (this.scope === undefined)
            return;
        await this.scope.replace({});
    }
    watch(callback) {
        this.changeCallback = callback;
        return () => {
            if (this.changeCallback === callback)
                this.changeCallback = undefined;
        };
    }
    dispose() {
        this.disposed = true;
        this.provider = undefined;
        this.scope = undefined;
        this.changeCallback = undefined;
    }
    attachProvider(provider) {
        if (this.disposed)
            return;
        if (this.provider === provider)
            return; // already attached to this instance (sync + inject both fired)
        if (!('register' in provider)) {
            this.provider = provider;
            this.ctx.on('settings/document-updated', () => this.onChange());
            this.onChange();
            return;
        }
        if (this.scope !== undefined) {
            // A previous provider instance was replaced (reload); drop the stale
            // handle so the re-registration below is clean.
            this.scope = undefined;
        }
        let scope;
        try {
            scope = provider.register(SETTINGS_NAMESPACE, MODE_SETTINGS_SCHEMA, {
                base: { mode: this.defaultMode }
            });
        }
        catch (error) {
            // Case 7 guard: an unreadable/invalid stored section must not take
            // the plugin down. Degrade to entry-only; the next successful read
            // (after the document is repaired externally) re-attaches.
            this.ctx.logger?.warn('requirements-alignment: settings registration rejected (invalid stored section?); '
                + 'staying on the profile default mode: %o', error);
            return;
        }
        this.provider = provider;
        this.scope = scope;
        // Observers are plugin-fiber effects: disposed on unload, idempotent
        // with the provider's own teardown.
        this.ctx.effect(() => {
            const offWatch = scope.watch(() => this.onChange());
            const offEvent = this.ctx.on('settings/document-updated', (ns) => {
                if (ns === SETTINGS_NAMESPACE)
                    this.onChange();
            });
            return () => {
                offWatch();
                offEvent();
            };
        });
        this.onChange();
    }
    requireScope() {
        const scope = this.scope;
        if (scope === undefined) {
            throw new Error('requirements-alignment: cannot persist a mode override: no settings service is mounted');
        }
        return scope;
    }
    descriptor() {
        if (this.provider === undefined || 'register' in this.provider)
            return undefined;
        // Bind to this exact loader instance, not another plugin with a familiar id.
        const editor = this.ctx.get('configEditor');
        // Cordis wraps plugin handles; uid survives those contextual proxies.
        const owner = editor?.entries().find(entry => entry.fiber?.uid === this.ctx.fiber.uid);
        if (owner === undefined)
            return undefined;
        return this.provider.describe().find(descriptor => descriptor.ns === owner.options.id);
    }
    requireDescriptor() {
        const descriptor = this.descriptor();
        if (descriptor === undefined)
            throw new Error('requirements-alignment: no live profile configuration entry is available');
        return descriptor;
    }
    userSectionHasMode() {
        const provider = this.provider;
        if (provider === undefined)
            return false;
        for (const descriptor of provider.describe()) {
            if (descriptor.ns !== SETTINGS_NAMESPACE)
                continue;
            const user = descriptor.user;
            return isRecord(user) && 'mode' in user;
        }
        return false;
    }
    onChange() {
        if (this.disposed)
            return;
        this.changeCallback?.();
    }
}
/**
 * Create the runtime ModeStore over the DSH Settings service with the
 * profile default as the base layer. Falls back to entry-only when no
 * settings service is (or will be) mounted.
 */
export function createModeStore(ctx, entry, logger) {
    const port = new SettingsModeStorePort(ctx, entry.mode);
    port.attach();
    return new ModeStore(port, entry.mode, logger);
}
export default SettingsModeStorePort;
//# sourceMappingURL=settings-mode-store.js.map