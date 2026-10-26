import { registerEstablishBaseline, registerReportDrift } from "./baseline-tool.js";
import { POLICY_ORDER, POLICY_SECTION, autoPolicyText } from "./policy.js";
/**
 * The per-agent capability registrar: registers one agent's alignment
 * capabilities in that agent's own scope for one effective mode.
 */
export class AlignmentRuntime {
    section;
    store;
    runManual;
    runMigrate;
    constructor(_ctx, options) {
        this.section = options.section;
        this.store = options.store;
        this.runManual = options.runManual;
        this.runMigrate = options.runMigrate;
    }
    /**
     * Register one agent's capabilities for `mode` in that agent's own scope.
     * Synchronous: returns the exact effect disposers. Callers own the
     * disposal (the controller), and `agent.ctx` also unwinds everything on
     * agent disposal — disposing these disposers manually is idempotent, so
     * the two never fight.
     */
    registerForAgent(agent, mode) {
        const disposers = [];
        try {
            if (mode === 'auto') {
                disposers.push(this.registerPolicy(agent));
                disposers.push(...this.registerTools(agent));
            }
            else if (mode === 'manual') {
                disposers.push(...this.registerTools(agent));
            }
            // 'off' registers nothing: the agent has no policy, no tools, no
            // /align. `/align-mode` is global (controller-owned) and survives.
            if (mode !== 'off') {
                disposers.push(...this.registerCommands(agent));
            }
            return disposers;
        }
        catch (error) {
            // A mid-registration failure must never leave a half-registered
            // capability set visible: unwind the partials collected so far
            // (each disposer is a synchronous, idempotent scope-table removal
            // that never throws), then surface the error so the controller can
            // roll the previous mode back. The caller therefore sees either a
            // complete live registration or no registration at all.
            for (const dispose of disposers)
                dispose();
            throw error;
        }
    }
    registerPolicy(agent) {
        const systemPrompt = agent.ctx.get('systemPrompt');
        if (systemPrompt === undefined)
            return () => void 0;
        return systemPrompt.section({
            name: POLICY_SECTION,
            order: POLICY_ORDER,
            text: (context) => {
                const caller = context.agent;
                if (caller === undefined)
                    return '';
                // The canonical alignment view: the durable sidecar, never the
                // session-event fold (persistence-compatibility fix).
                return autoPolicyText(this.section, this.store.getStatus(caller.session));
            }
        });
    }
    registerTools(agent) {
        const tools = agent.ctx.get('tools');
        if (tools === undefined)
            return [];
        return [
            registerEstablishBaseline(agent.ctx, this.store),
            registerReportDrift(agent.ctx, this.store)
        ];
    }
    registerCommands(agent) {
        const commands = agent.ctx.get('commands');
        if (commands === undefined)
            return [];
        const definitions = [
            {
                name: 'align',
                description: 'Check whether the current execution still matches the requirement baseline',
                handler: ({ agent: caller, rawInput }) => this.runManual(caller, rawInput)
            },
            {
                name: 'align-migrate',
                description: 'Migrate a legacy session artifact: mark the plugin\'s old alignment/* events ignorable so any DSH build can open it (explicit, gated, idempotent)',
                handler: ({ agent: caller, rawInput }) => this.runMigrate(caller, rawInput)
            }
        ];
        // Register incrementally: a failure mid-way must NOT leave the
        // commands already registered live. Unwind the collected disposers
        // (each is a synchronous, idempotent scope-table removal that never
        // throws) before the error surfaces, so the caller sees either the
        // full command set or none at all — never a half-registered set.
        const disposers = [];
        try {
            for (const definition of definitions) {
                disposers.push(commands.register(definition));
            }
            return disposers;
        }
        catch (error) {
            for (const dispose of disposers)
                dispose();
            throw error;
        }
    }
}
export default AlignmentRuntime;
//# sourceMappingURL=runtime-mode-controller.js.map