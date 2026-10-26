/**
 * AlignmentRuntime: the per-agent capability registrar for Requirements
 * Alignment. Since v0.4.0, alignment capabilities are registered in each
 * agent's OWN scope (`agent.ctx`), never at plugin scope — the plugin scope
 * only registers the always-on `/align-mode` control command (owned by the
 * controller). This is the v0.3.0 global register/dispose model retired:
 *
 *   v0.3.0: applyMode(mode) registered/unregistered ONE global capability set.
 *   v0.4.0: registerForAgent(agent, mode) returns that agent's scoped
 *           registrations; the controller owns the lifecycle (session-start,
 *           mode-change resync, disposal) and the per-session effective mode.
 *
 * Capability matrix per agent effective mode:
 *
 *   automatic   = the policy system-prompt section
 *   interactive = `establish_baseline`, `report_drift`, `/align`, `/align-migrate`
 *
 *   Auto:   automatic + interactive
 *   Manual: interactive
 *   Off:    (nothing — the agent has no policy section, no alignment tools,
 *           and no `/align`; only the globally-registered `/align-mode`
 *           remains, so the user can switch this session back without editing
 *           settings.yaml)
 *
 * Every registration is made through `agent.ctx`, the agent-scoped Cordis
 * context: its contributions are agent-local, unwind on disposal, and reject
 * registration afterward. A scoped tool/section/command shadows the global
 * layer for that agent only, so two live sessions with different effective
 * modes hold disjoint capability sets with no leakage. `/align-mode` is not
 * here: it is always registered at plugin scope by the controller so it stays
 * usable from an Off session.
 *
 * Failure safety: `registerForAgent` is fully synchronous and returns the
 * exact disposers. If a registration throws mid-way, the partials collected
 * so far are unwound inside `registerForAgent` before the error surfaces —
 * the caller sees either a complete live registration or no registration at
 * all, never a half-registered capability set. The controller then restores
 * the previous mode by RE-REGISTERING it (fresh disposers), never by
 * resurrecting an executed registration.
 *
 * Canonical alignment state goes through the {@link AlignmentStateStore}
 * sidecar, never session events: the policy section renders the store's
 * per-session status, and the model-facing tools are registered against the
 * store. Baseline/event state is untouched by any mode transition — switching
 * modes never deletes a baseline, the sidecar, or session events.
 *
 * @module dsh-requirements-alignment/runtime-mode-controller
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt';
import type { AlignmentStateStore } from './alignment-state-store.ts';
import type { AlignmentMode } from './types.ts';
/** The assembly context the policy section reads (bare assemble has no agent). */
export type AlignmentAssemblyContext = AssembleContext & {
    agent?: Agent;
};
/** Options for constructing an {@link AlignmentRuntime}. */
export interface AlignmentRuntimeOptions {
    /** Deployment-owned policy text replacing the shipped default (auto mode). */
    section?: string;
    /** The canonical alignment state store (durable sidecar) the runtime reads and registers against. */
    store: AlignmentStateStore;
    /** The `/align` command body (owned by the controller, not the runtime). */
    runManual: (agent: Agent, rawInput: string) => CommandResult | Promise<CommandResult>;
    /** The `/align-migrate` command body (legacy-artifact repair; auto/manual only). */
    runMigrate: (agent: Agent, rawInput: string) => CommandResult | Promise<CommandResult>;
}
/**
 * The per-agent capability registrar: registers one agent's alignment
 * capabilities in that agent's own scope for one effective mode.
 */
export declare class AlignmentRuntime {
    private readonly section;
    private readonly store;
    private readonly runManual;
    private readonly runMigrate;
    constructor(_ctx: Context, options: AlignmentRuntimeOptions);
    /**
     * Register one agent's capabilities for `mode` in that agent's own scope.
     * Synchronous: returns the exact effect disposers. Callers own the
     * disposal (the controller), and `agent.ctx` also unwinds everything on
     * agent disposal — disposing these disposers manually is idempotent, so
     * the two never fight.
     */
    registerForAgent(agent: Agent, mode: AlignmentMode): Array<() => void>;
    private registerPolicy;
    private registerTools;
    private registerCommands;
}
export default AlignmentRuntime;
//# sourceMappingURL=runtime-mode-controller.d.ts.map