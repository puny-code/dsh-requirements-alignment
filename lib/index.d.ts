/**
 * dsh-requirements-alignment: a native DeepSeek Harness plugin that acts as a
 * runtime requirement drift guard.
 *
 * While an agent executes, the plugin keeps a durable requirement baseline
 * per session (goal, explicit constraints, must-preserve behavior, allowed
 * scope, settled user decisions) in the AlignmentStateStore sidecar — the
 * official `ctx.storageDomain` KV domain — NOT in session events. Since the
 * persistence-compatibility fix, production code never appends `alignment/*`
 * events: the DSH persistence reader's generated known-event vocabulary does
 * not contain them, and an appended event makes the session unreadable to
 * every DSH build (SessionFormatUnsupportedError). New sessions created by
 * this plugin load, replay, and resume under a bare DSH reader with zero
 * alignment footprint. Auto mode (default) contributes a policy section to
 * every agent's system prompt that teaches silent drift detection and the
 * re-alignment protocol, plus two model-facing tools: `establish_baseline`
 * (silent baseline recording) and `report_drift` (drift candidate + user
 * decision). Manual mode contributes no section; the `/align` command steers
 * a compact fresh-alignment inspection into the agent. Both modes record
 * durable per-session state that survives resume, historical fork, and
 * compaction through whole-state checkpoints (`{visibleThroughSeq, state}`),
 * and `/align-migrate` repairs legacy sessions whose artifacts still carry
 * alignment/* events.
 *
 * v0.3.0 — persistent runtime mode & hot switching. The static single
 * `config.mode` becomes a three-layer model:
 *
 *   valid persisted override  ->  valid profile default  ->  auto
 *
 * The profile (`config.mode`) is the composition default layer; a user
 * override is persisted through SettingsForms in profile `runtimeMode`;
 * the effective mode is whichever layer resolves. ModeStore owns that
 * resolution.
 *
 * v0.4.0 — session-scoped mode selector. A fourth layer is added in front:
 *
 *   valid session override  ->  valid persisted runtime override
 *                            ->  valid profile default  ->  auto
 *
 * The session layer is persisted per-session (SessionModeStore sidecar) and
 * lets one session use Auto, Manual, or Off without changing the effective
 * mode of other live sessions. Alignment capabilities (the policy section,
 * both tools, `/align`, `/align-migrate`) are no longer registered at plugin
 * scope: they are registered in each agent's OWN scope (`agent.ctx`) when the
 * session starts, and the controller re-syncs an agent's capabilities when
 * its effective mode changes. Only `/align-mode` stays registered at plugin
 * scope so a live switch to Off is reversible. Mode persistence (Settings),
 * session-mode persistence (sidecar), and alignment-state persistence
 * (sidecar) are fully independent: switching or resetting any mode never
 * deletes a baseline, the sidecar, or session events.
 *
 * The plugin is a plain Cordis service: every registration is an effect
 * disposer owned by this fiber, so unloading the plugin (or disabling the
 * row) restores the previous behavior.
 *
 * @module dsh-requirements-alignment
 */
import { Service } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type Volatile } from '@deepseek-ai/cosmokit';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandResult } from '@deepseek-ai/dsh-commands';
import { AlignmentStateStore, type AlignmentSessionLike } from './alignment-state-store.ts';
import { SessionModeStore } from './session-mode-store.ts';
import { ALIGNMENT_MODES, type AlignmentMode, type AlignmentSource, type AlignmentStatus, type AlignmentStatusValue, type EffectiveMode } from './types.ts';
import { ModeStore, type ModeSnapshot } from './mode-store.ts';
import { AlignmentRuntime } from './runtime-mode-controller.ts';
import { type AlignmentStatusPayload } from './management-api.ts';
/** Alignment operation mode. */
export type { AlignmentMode };
export { ALIGNMENT_MODES };
/** Raw plugin config. */
export interface Config {
    /** Profile default: `auto` (default) contributes the policy section; `manual` only the /align command and tools; `off` nothing. A persisted override wins over this at runtime. */
    mode?: AlignmentMode | Volatile<AlignmentMode>;
    /** Persisted shared override; null follows the profile mode. */
    runtimeMode?: AlignmentMode | null | Volatile<AlignmentMode | null>;
    /** Optional deployment-owned policy text replacing the shipped one (auto mode). */
    section?: string;
}
/**
 * DSH/Schemastery Config schema for configuration structure, loading, and
 * validation. `mode` is the enum `auto` / `manual` / `off` — the profile
 * default layer. YAML stays `mode: auto|manual|off` (default `auto`). Cordis
 * validates incoming config through this schema's Standard Schema contract
 * before the plugin starts.
 */
export declare const ConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    runtimeMode: Schema<"auto" | "manual" | "off" | null, "auto" | "manual" | "off" | null, "volatile-defined">;
    mode: Schema<"auto" | "manual" | "off", "auto" | "manual" | "off", "volatile-defined">;
    section: Schema<string, string, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    runtimeMode: Schema<"auto" | "manual" | "off" | null, "auto" | "manual" | "off" | null, "volatile-defined">;
    mode: Schema<"auto" | "manual" | "off", "auto" | "manual" | "off", "volatile-defined">;
    section: Schema<string, string, "plain">;
}>>, "plain">;
/** A validated, detached config. */
export interface ResolvedConfig {
    mode: AlignmentMode;
    runtimeMode?: AlignmentMode | null;
    section?: string;
}
/**
 * Validate deployment-owned config. Missing, blank, or unknown fields fail at
 * plugin load rather than being ignored (same stance as dsh-plan-mode).
 *
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export declare function resolveConfig(config?: Config): ResolvedConfig;
/** Human-readable status label for one folded posture. */
export declare function statusValueText(value: AlignmentStatusValue): string;
/** Capitalized mode label shown on `/align` and `/align-mode`. */
export declare function modeStatusLabel(mode: AlignmentMode): 'Auto' | 'Manual' | 'Off';
/** Where the effective mode came from, in `/align` wording. */
export declare function sourceStatusLabel(source: AlignmentSource): string;
/**
 * Human-readable multi-line status report for the `/align` command result.
 * Reports the folded baseline state and the calling session's effective mode;
 * it never claims to block execution. Mode is taken from the live effective
 * resolution (session -> runtime override -> profile default), not the fold.
 */
export declare function statusText(status: AlignmentStatus, effective?: EffectiveMode): string;
/**
 * Human-readable snapshot of the shared three-layer runtime mode (runtime
 * override -> profile default), used after a shared `/align-mode` switch.
 */
export declare function modeSnapshotText(snapshot: ModeSnapshot): string;
/**
 * Human-readable snapshot of the four-layer mode resolution for one session:
 * the session override, the shared runtime override, the profile default, and
 * the session's effective mode with its exact source. Used by `/align-mode`
 * (no argument, or the `session` sub-command) so a user can see exactly which
 * layer produced the current session's effective mode.
 */
export declare function sessionModeSnapshotText(effective: EffectiveMode, sessionOverride: AlignmentMode | undefined, shared: ModeSnapshot): string;
/**
 * Fail-closed capability bookkeeping for one agent whose mode transition
 * could not be completed: the previous mode was torn down, the next mode's
 * registration failed, AND re-registering the previous mode failed too. Such
 * an agent has NO live alignment capability (never a Map entry — a Map entry
 * must always correspond to a live registration) and is pending
 * reconciliation: the next successful sync (any mode trigger) clears it.
 */
export interface DegradedRegistration {
    /** The mode the transition was moving to when registration failed. */
    targetMode: AlignmentMode;
    /** The mode that was live before the transition (the failed rollback target). */
    previousMode: AlignmentMode | undefined;
    /** The registration failure that aborted the transition. */
    primaryError: Error;
    /** The rollback re-registration failure, when the previous mode could not be restored. */
    rollbackError: Error | undefined;
    /** When the degradation was recorded. */
    since: number;
}
/** The exact source topology of one mode layer (shared runtime override or a
 * session override): whether an override EXISTS and, when it does, its value.
 * Presence matters: an inherited (override-less) session is compensated by
 * CLEARING - never by writing an equal-value override. */
export interface OverrideTopology {
    /** Whether the layer currently carries an override. */
    present: boolean;
    /** The override value, when present. */
    mode?: AlignmentMode;
}
/**
 * The result of reconciling one live agent's capabilities to its session's
 * effective mode. Used by the transactional mode mutations to decide whether
 * the persisted source commit can stand.
 *
 *  - unchanged / converged: the agent's capabilities now implement the
 *    effective mode - the persisted source commit can stand;
 *  - rolledback: the next-mode registration failed and the previous mode was
 *    re-registered with fresh disposers - the source MUST be compensated back;
 *  - degraded: the next-mode registration failed AND the previous-mode
 *    rollback failed too (fail-closed, pending reconciliation) - the source
 *    MUST be compensated back.
 */
export type SyncOutcome = {
    kind: 'unchanged';
} | {
    kind: 'converged';
    mode: AlignmentMode;
} | {
    kind: 'rolledback';
    targetMode: AlignmentMode;
    activeMode: AlignmentMode;
    error: Error;
} | {
    kind: 'degraded';
    targetMode: AlignmentMode;
    previousMode: AlignmentMode | undefined;
    error: Error;
};
/**
 * A mode-SOURCE write that failed while compensating after a failed capability
 * transition: the runtime capabilities are (back) at the previous mode, but
 * the persisted source could not be restored to it, so the advertised
 * effective mode diverges from the active capability mode. This is the
 * explicit, never-silent pending state: exposed on the status payload,
 * retried on the next mutation, and cleared the moment the compensation write
 * lands.
 */
export interface PendingModeCompensation {
    kind: 'shared' | 'session';
    /** The session whose override is being compensated, when kind === 'session'. */
    session?: AlignmentSessionLike;
    /** The exact previous source topology being restored. */
    previousOverride: OverrideTopology;
    /** The topology the failed mutation attempted to write. */
    attemptedOverride: OverrideTopology;
    /** The write failure. */
    error: Error;
    /** When the pending compensation was recorded. */
    since: number;
}
/**
 * The alignment controller: owns the ModeStore (shared layer), the
 * SessionModeStore (session layer), the AlignmentStateStore sidecar, and the
 * per-agent capability lifecycle; provides the `requirementsAlignment`
 * service.
 *
 * Startup ordering: the controller opens both sidecars and adopts every
 * session as it starts — importing legacy timelines, pinning fork inheritance
 * (alignment state AND session-mode override), and registering that agent's
 * alignment capabilities per its effective mode. Runs in every mode
 * (including off), so switching modes never loses state.
 *
 * Capability model (v0.4.0): alignment capabilities live in each agent's own
 * scope. The serial `agent/created` listener adopts sidecars, then resolves
 * the session's effective mode (session override -> shared override -> profile
 * default -> auto) and registers the matching capabilities on `agent.ctx`.
 * `/align-mode session` changes only the calling session's override (and
 * resyncs that agent); `/align-mode` changes the shared runtime override (and
 * resyncs every agent that has no session override). An Off session has no
 * alignment capabilities at all — only `/align-mode` (globally registered)
 * remains, so it can switch itself back.
 */
export declare class RequirementsAlignmentController extends Service {
    static inject: string[];
    /** Native Config schema (enum `mode`) for Cordis load validation. */
    static Config: Schema<Schemastery.ObjectS<NoInfer<{
        runtimeMode: Schema<"auto" | "manual" | "off" | null, "auto" | "manual" | "off" | null, "volatile-defined">;
        mode: Schema<"auto" | "manual" | "off", "auto" | "manual" | "off", "volatile-defined">;
        section: Schema<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        runtimeMode: Schema<"auto" | "manual" | "off" | null, "auto" | "manual" | "off" | null, "volatile-defined">;
        mode: Schema<"auto" | "manual" | "off", "auto" | "manual" | "off", "volatile-defined">;
        section: Schema<string, string, "plain">;
    }>>, "plain">;
    /** Validated profile config (the default layer; not the effective mode). */
    readonly config: ResolvedConfig;
    /** The canonical alignment state store (durable sidecar + in-memory view). */
    readonly stateStore: AlignmentStateStore;
    /** The session-mode override store (durable sidecar, per-session). */
    readonly sessionModeStore: SessionModeStore;
    /** The shared runtime mode authority (desired/effective + persisted override). */
    readonly modeStore: ModeStore;
    /** The per-agent capability registrar (registers on `agent.ctx`). */
    readonly runtime: AlignmentRuntime;
    /**
     * Live agents and the capability set currently registered in their scope:
     * agent id -> { the mode those capabilities implement, their disposers }.
     *
     * INVARIANT: every entry corresponds to a capability set that is live at
     * this instant — entries are created only from the disposers of a
     * successful registration and are never reused after those disposers
     * executed. Observable for tests and the management surface; treat as
     * read-only.
     */
    readonly agentCapabilities: Map<string, {
        mode: AlignmentMode;
        disposers: Array<() => void>;
    }>;
    /**
     * Agents whose capability transition failed closed: agent id -> the failed
     * transition (target mode, previous mode, primary + rollback error
     * provenance). These agents have NO live alignment capability — they never
     * appear in {@link agentCapabilities} — and the next successful sync
     * clears the marker (pending reconciliation).
     */
    readonly degradedAgents: Map<string, DegradedRegistration>;
    /**
     * Pending mode-SOURCE compensation writes (v0.4.1 atomicity): a persisted
     * source write failed while compensating after a failed capability
     * transition. Keyed by SHARED_MODE_KEY for the shared runtime override or
     * by the session key for a session override. The next mutation retries
     * these; the entry is deleted the moment the compensation write lands. A
     * pending entry means the advertised effective mode may NOT yet match the
     * active capability mode - the state is exposed, never silent.
     */
    readonly pendingSourceCompensation: Map<string, PendingModeCompensation>;
    /** Nesting depth of an in-progress mode mutation owning the reconcile. */
    private exclusiveReconcile;
    /** A shared-layer subscription fired while a mutation owned the reconcile. */
    private deferredSharedReconcile;
    /** Session-key subscription fires deferred while a mutation owned the reconcile. */
    private deferredSessionKeys;
    /** The `/align-mode` registration (the always-on plugin-scope control command). */
    private modeCommandDisposer;
    constructor(ctx: import('@deepseek-ai/cordis').Context, config?: Config);
    /**
     * The effective mode of one session: the session override when one exists,
     * otherwise the shared resolution (persisted override -> profile default).
     * Every per-agent capability decision reads this.
     */
    effectiveModeFor(session: AlignmentSessionLike): EffectiveMode;
    /**
     * Resolve one session id to its live agent (the management API's session
     * handle; the floating manager only addresses currently-selected sessions,
     * which are always live). `undefined` when the session is not live.
     */
    liveAgent(sessionId: SessionId): Agent | undefined;
    /**
     * The four-layer + folded-baseline picture the floating manager renders.
     * The exact payload contract of `GET /_dsh/requirements-alignment/status`.
     */
    alignmentStatusPayload(agent: Agent): AlignmentStatusPayload;
    /**
     * Awaited plugin startup hook (Cordis `Service.init`): opens both sidecar
     * domains (durable records land in memory before any session can exist)
     * and adopts every session as it starts — importing legacy timelines,
     * pinning fork inheritance, and registering the agent's alignment
     * capabilities per its effective mode. Runs in every mode (including off),
     * so switching modes never loses state. Mounts the management API for the
     * floating Web manager when a web server is present.
     */
    [Service.init](): Promise<void>;
    /**
     * Adopt one session's durable sidecars: pin fork inheritance (alignment
     * state + session-mode override), before initial capability registration
     * in `agent/created`. Subsequent changes re-sync capabilities through the
     * SessionModeStore subscription. Idempotent — repeated
     * adoption never duplicates state or capabilities.
     */
    private initializeSessionState;
    /**
     * Align one live agent's registered capabilities with its session's
     * effective mode. A no-op when the mode is unchanged. The transition is
     * transactional:
     *
     *   1. the outgoing registrations are disposed (each disposer is a
     *      synchronous, idempotent scope-table removal that never throws —
     *      proven by the runtime tests);
     *   2. the incoming mode is registered on the agent's own scope;
     *   3. only a successful registration is committed to the Map;
     *   4. a failed registration rolls back by RE-REGISTERING the previous
     *      mode with fresh disposers — the disposed record is never put back
     *      (its disposers already ran, so it would be dead bookkeeping);
     *   5. if the rollback re-registration fails too, the agent fails closed:
     *      the Map records nothing and the degradation is marked explicitly
     *      (pending reconciliation), never silently papered over.
     *
     * Invariant: an `agentCapabilities` entry ALWAYS corresponds to a live
     * capability set.
     */
    private syncAgent;
    /**
     * Fail-loud handling of a capability transition whose next-mode
     * registration AND its previous-mode rollback re-registration both
     * failed. The agent ends with NO live alignment capability: the Map
     * records nothing (a Map entry must always correspond to a live
     * registration), and the double failure is recorded explicitly with both
     * error provenance so recovery is observable. Any later sync trigger
     * retries and, on success, clears the marker.
     */
    private failLoudDoubleFailure;
    /**
     * The container-owned reconcile for every agent that has NO session
     * override, plus every fail-closed (degraded) agent. Returns one outcome
     * per affected live agent. The mode mutations call this DIRECTLY (while
     * owning the reconcile exclusively); the shared-layer subscription defers
     * to them via {@link onSharedModeChange}.
     */
    private reconcileSharedAgents;
    /** Re-sync exactly one session's agent; no-op when the session is not live. */
    private syncAgentFor;
    /**
     * Subscription handler for SHARED-layer changes (a mode mutation's own
     * persist, or an external settings edit). While a mutation owns the
     * reconcile the event is deferred and the mutation drives the sync;
     * otherwise the shared reconcile runs now.
     */
    private onSharedModeChange;
    /**
     * Subscription handler for SESSION-override changes (a mutation's own
     * persist, or an external session edit). Deferred while a mutation owns
     * the reconcile, as with {@link onSharedModeChange}.
     */
    private onSessionModeChange;
    /** If events were deferred to the owning mutation, apply them now. */
    private flushDeferred;
    /** Drop deferred reconcile events without applying them (failed mutation). */
    private discardDeferred;
    /** Enter/exit the exclusive reconcile window owned by a mode mutation. */
    private enterExclusive;
    private exitExclusive;
    /** The current topology of the SHARED runtime override layer. */
    private sharedTopology;
    /** The current topology of one session's override layer. */
    private sessionTopology;
    /**
     * Compensate the SHARED source back to its previous topology after a
     * failed capability transition. On write failure the compensation stays
     * pending (explicit, exposed, retried on the next mutation) instead of
     * reverting silently.
     */
    private compensateSharedSource;
    /**
     * Compensate a SESSION source back to its previous topology after a failed
     * capability transition, with the same pending-on-write-failure semantics
     * as {@link compensateSharedSource}. Presence semantics: an inherited
     * (override-less) session is compensated by CLEARING, never by writing an
     * equal-value override.
     */
    private compensateSessionSource;
    /**
     * Replay every pending source compensation (restore the previous source
     * topology). The restoring write itself notifies, so a successful replay
     * converges the capability side. A replay that fails stays pending; the
     * mutation proceeds regardless (the caller's explicit request is the
     * latest intent and a successful commit clears the stale pending entry).
     */
    private retryPendingCompensations;
    /** Whether every reconcile outcome is converged. */
    private allConverged;
    /**
     * The human-readable failure surfaced by a mode mutation that could not
     * reconcile every affected agent: names each failing agent's error and
     * whether the source was reverted or is pending compensation.
     */
    private transactionError;
    /**
     * Register `/align-mode` at plugin scope (always available, including Off).
     * The control group is the only plugin-scope alignment contribution in
     * v0.4.0 — everything else is per-agent.
     */
    private registerModeCommand;
    /**
     * Run one manual alignment inspection: record the check in the sidecar,
     * report the folded status (with the calling session's effective mode),
     * and hand a fresh alignment check to the agent as a steered user message.
     * Never blocks and never takes over the workflow. A failed manual-check
     * record (e.g. no durable medium) is logged and never prevents the
     * inspection itself from running.
     *
     * @param agent The receiving agent.
     * @param _rawInput Unused (bare command); reserved for future arguments.
     * @returns The command result rendered by the dispatching UI.
     */
    runManualAlignment(agent: Agent, _rawInput: string): Promise<CommandResult>;
    /**
     * `/align-mode` body: report the calling session's four-layer snapshot,
     * switch the SHARED runtime override (`auto` / `manual` / `off`), `reset`
     * it to the profile default, or operate on the SESSION override only via
     * the `session` sub-command. Always registered, including in Off.
     */
    runModeCommand(agent: Agent, rawInput: string): Promise<CommandResult>;
    /**
     * `/align-mode session` body: report the calling session's four-layer
     * snapshot, set a SESSION-scoped override (`auto` / `manual` / `off`), or
     * `reset` it (the session returns to the shared layers). Only the calling
     * session is affected — other live sessions and the shared runtime
     * override never move. Works from an Off session (`/align-mode` is
     * globally registered).
     */
    runSessionModeCommand(agent: Agent, arg: string): Promise<CommandResult>;
    /**
     * The four-layer snapshot text for one agent's session.
     */
    private sessionModeSnapshotText;
    /**
     * Change the SHARED runtime override and make it durable — ONE transaction
     * with the capability layer (v0.4.1 atomicity):
     *
     *   1. replay any pending source compensation (restore the previous source);
     *   2. capture the previous shared topology;
     *   3. persist the target override (a failed persist throws, nothing moves);
     *   4. reconcile every agent without a session override against the target;
     *   5. if EVERY affected agent converges, the commit stands and any stale
     *      pending compensation is cleared;
     *   6. if ANY agent could not converge, the persisted source is compensated
     *      back to its previous topology (never left claiming the target) and
     *      the mutation THROWS — the caller (command / management API) reports
     *      failure, never a fake `switched to <target>`.
     *
     * A compensation write that fails to land is recorded as PENDING (exposed
     * on the status payload, retried on the next mutation) instead of leaving a
     * silent split-brain.
     *
     * @param mode The desired shared mode.
     * @returns The resulting snapshot.
     * @throws On an invalid mode, a failed persistence write, or a failed
     *   capability transition (after compensating the source back).
     */
    setMode(mode: AlignmentMode): Promise<ModeSnapshot>;
    /**
     * Drop the shared persisted override and return to the profile default —
     * ONE transaction with the capability layer, exactly like {@link setMode}:
     * capture the previous shared topology, persist the reset, reconcile every
     * agent without a session override, and compensate the source back (or
     * record a pending compensation) when an agent could not converge. Throws
     * on failure so the caller never claims the reset succeeded.
     *
     * @returns The resulting snapshot (effective source `profile`).
     * @throws On a failed persistence reset or a failed capability transition
     *   (after compensating the source back).
     */
    resetMode(): Promise<ModeSnapshot>;
    /**
     * Set a SESSION-scoped override — ONE transaction with the capability
     * layer, mirroring {@link setMode}: persist the override, reconcile exactly
     * the affected session's agent, and on a failed transition compensate the
     * session source back to its previous topology with presence semantics (an
     * inherited session is compensated by CLEARING, never by an equal-value
     * override). Throws on failure so the command / management API reports it.
     *
     * @param session The session to change (only its agent is affected).
     * @param mode The desired session mode.
     * @throws On an invalid mode, a failed persist, or a failed capability
     *   transition (after compensating the session source back).
     */
    setSessionMode(session: AlignmentSessionLike, mode: AlignmentMode): Promise<void>;
    /**
     * Clear a SESSION-scoped override (the session returns to the shared
     * layers) — ONE transaction with the capability layer, like
     * {@link setSessionMode}. Throws on failure (after compensating the
     * session source back), so the command / management API never claims the
     * reset succeeded when the agent could not converge.
     *
     * @param session The session to change.
     * @throws On a failed persist or a failed capability transition (after
     *   compensating the session source back).
     */
    clearSessionOverride(session: AlignmentSessionLike): Promise<void>;
    /**
     * The `/align-migrate` command body: run the explicit, gated legacy
     * artifact migration for one stored session. The session id comes from
     * the command input; without one, the calling agent's own session id is
     * used. Errors (live writer, missing artifact, any failed safety gate)
     * are reported as command errors and never touch the artifact.
     *
     * @param agent The receiving agent (whose session id is the default target).
     * @param rawInput The command input (a session id, when given).
     * @returns The command result rendered by the dispatching UI.
     */
    runMigrate(agent: Agent, rawInput: string): Promise<CommandResult>;
}
export default RequirementsAlignmentController;
//# sourceMappingURL=index.d.ts.map