/** Raw driver config. */
export interface AlignDriverConfig {
    /** Absolute path of the JSONL record file appended per execution. */
    recordPath?: string;
    /**
     * Run `/align` through the real commands registry at session start (dogfood
     * cases 6-7). Snapshots are recorded regardless.
     */
    runAlign?: boolean;
    /** Execute establish_baseline through the real tools registry at session start (packed smoke; no model call required). */
    runBaselineProbe?: boolean;
    /**
     * Append one synthetic `ask_user_question` tool call to every top-level
     * session before `/align`, to verify that unrelated questions never
     * pollute alignment state (dogfood case 5).
     */
    injectAskUserCall?: boolean;
    /**
     * Record a snapshot at the first non-read-only tool call, to prove the
     * baseline was established before any mutation (dogfood case 3).
     */
    snapshotFirstMutation?: boolean;
    /**
     * Halt the process after the first new alignment decision becomes visible
     * in the canonical alignment state, so an interrupted session's durable
     * state can be captured at the decision point (dogfood case 11, phase A).
     * The snapshot is recorded and the persistence batch is given time to
     * flush before exit.
     *
     * In v0.2.2 production appends no `alignment/decision` session events; the
     * driver observes `lastDecision` from the AlignmentStateStore sidecar (the
     * legacy fold remains only as a fallback when no store exists).
     */
    haltAtDecision?: boolean;
    /**
     * Assemble the REAL system prompt for the session at start (through the
     * systemPrompt service) and record whether the
     * `requirements-alignment:policy` section is present in the assembled
     * section registry, plus the head of its resolved text. Deterministic
     * proof that the policy section is live — used by the packed smoke
     * (dogfood-only; the product plugin never mounts the driver).
     */
    verifyPolicySection?: boolean;
    /**
     * Record the three-mode registration matrix from the live registries:
     * policy section presence (assembled system prompt), alignment tools
     * (`establish_baseline`, `report_drift`), and `/align`. Used by the
     * packed smoke Auto → Manual → Off cycle.
     */
    verifyRegistrations?: boolean;
    /**
     * Two-session isolation probe (dogfood 13): once a SUBAGENT session
     * appears, switch the recorded top-level agent to a session override
     * (`switchTopLevelTo`, default `off`) and record the top-level agent's
     * capability matrix before and after. The subagent itself keeps the mode
     * it inherited at creation, proving two sessions hold different effective
     * modes with no leakage.
     */
    switchTopLevelOnSubagent?: boolean;
    /** The session mode the top-level agent is switched to (default `off`). */
    switchTopLevelTo?: 'auto' | 'manual' | 'off';
    /**
     * Switch the SHARED runtime override through the REAL `/align-mode`
     * command at top-level session start (packed mode-switch smoke, v0.4.1):
     * the capability matrix is recorded BEFORE and AFTER the switch, proving
     * the transactional commit (persisted source AND live capabilities
     * converge, advertised effective mode matches the active capability mode).
     */
    switchSharedModeTo?: 'auto' | 'manual' | 'off';
}
/** A validated, detached config. */
export interface ResolvedAlignDriverConfig {
    recordPath?: string;
    runAlign?: boolean;
    runBaselineProbe?: boolean;
    injectAskUserCall?: boolean;
    snapshotFirstMutation?: boolean;
    haltAtDecision?: boolean;
    verifyPolicySection?: boolean;
    verifyRegistrations?: boolean;
    switchTopLevelOnSubagent?: boolean;
    switchTopLevelTo?: 'auto' | 'manual' | 'off';
    switchSharedModeTo?: 'auto' | 'manual' | 'off';
}
/** Validate driver config; unknown keys fail loud. */
export declare function resolveAlignDriverConfig(config?: AlignDriverConfig): ResolvedAlignDriverConfig;
/**
 * Mount the driver: at every serial `agent/created`, record an initial
 * snapshot; optionally inject the isolation probe; for top-level agents run
 * `/align` through the real commands registry; and record a snapshot at every
 * `turn/end` of every session.
 *
 * @param ctx The plugin context.
 * @param config Driver configuration.
 */
export declare function apply(ctx: import('@deepseek-ai/cordis').Context, config?: AlignDriverConfig): void;
export declare const name = "align-driver";
export { apply as default };
//# sourceMappingURL=align-driver.d.ts.map