/** One scripted answer. */
export interface ScriptedAnswer {
    /** Substring matched against the question text; omitted matches everything. */
    match?: string;
    /**
     * Select the first option whose label contains this substring. Useful for
     * drift questions whose option labels are model-supplied: the answer stays
     * correct regardless of the exact wording. Takes precedence over `selected`.
     */
    optionMatch?: string;
    /** Option labels to select. */
    selected?: string[];
    /** Free-form "Other" answer. */
    custom?: string;
}
/** Raw provider config. */
export interface ScriptedProviderConfig {
    /** Answers tried in order; the first matching `match` wins. */
    answers?: ScriptedAnswer[];
    /** Fallback used when no answer matches; defaults to an empty answer. */
    default?: ScriptedAnswer;
    /** Absolute path of the JSONL record file appended per answered request. */
    recordPath?: string;
}
/** A validated, detached config. */
export interface ResolvedScriptedProviderConfig {
    answers: ScriptedAnswer[];
    default: ScriptedAnswer;
    recordPath?: string;
}
/** Validate provider config; unknown keys fail loud. */
export declare function resolveScriptedConfig(config?: ScriptedProviderConfig): ResolvedScriptedProviderConfig;
/**
 * Mount the scripted provider on `ctx.userQuestions`.
 *
 * @param ctx The plugin context.
 * @param config Provider configuration.
 */
export declare function apply(ctx: import('@deepseek-ai/cordis').Context, config?: ScriptedProviderConfig): void;
export declare const name = "scripted-answers";
export { apply as default };
//# sourceMappingURL=scripted-provider.d.ts.map