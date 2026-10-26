/**
 * Scripted user-questions provider for tests and dogfooding only.
 *
 * Registers a deterministic `ctx.userQuestions` provider that answers every
 * question from configuration instead of a human UI. Intended to be mounted in
 * disposable test profiles (see `scripts/dogfood.ps1`); the product plugin
 * never mounts it. Answers are recorded as JSONL at `recordPath` when set, so
 * automated runs can assert what was asked.
 *
 * @module dsh-requirements-alignment/scripted-provider
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** Validate provider config; unknown keys fail loud. */
export function resolveScriptedConfig(config = {}) {
    const unknown = Object.keys(config).filter((key) => key !== 'answers' && key !== 'default' && key !== 'recordPath');
    if (unknown.length > 0)
        throw new Error(`ScriptedProviderConfig has unknown key(s) ${unknown.join(', ')} - config is { answers?, default?, recordPath? }`);
    const answers = config.answers ?? [];
    if (!Array.isArray(answers))
        throw new Error('ScriptedProviderConfig answers must be an array');
    return {
        answers,
        default: config.default ?? { selected: [] },
        ...(config.recordPath === undefined ? {} : { recordPath: config.recordPath })
    };
}
/** Append one JSONL record without crashing the run on I/O failure. */
function record(recordPath, line) {
    if (recordPath === undefined)
        return;
    try {
        mkdirSync(dirname(recordPath), { recursive: true });
        appendFileSync(recordPath, JSON.stringify(line) + '\n', 'utf8');
    }
    catch {
        // Recording is best-effort for assertions; never break the loop.
    }
}
/**
 * Mount the scripted provider on `ctx.userQuestions`.
 *
 * @param ctx The plugin context.
 * @param config Provider configuration.
 */
export function apply(ctx, config = {}) {
    const resolved = resolveScriptedConfig(config);
    const provider = {
        ask: async (request) => {
            const answers = request.questions.map((question) => {
                const hit = resolved.answers.find((answer) => answer.match === undefined || question.question.includes(answer.match))
                    ?? resolved.default;
                let selected = hit.selected ?? [];
                if (hit.optionMatch !== undefined) {
                    const matched = (question.options ?? []).find((option) => option.label.includes(hit.optionMatch));
                    if (matched !== undefined)
                        selected = [matched.label];
                }
                const answer = {
                    id: question.id,
                    selected
                };
                if (hit.custom !== undefined)
                    answer.custom = hit.custom;
                record(resolved.recordPath, {
                    at: Date.now(),
                    id: question.id,
                    question: question.question,
                    answer
                });
                return answer;
            });
            return { answers };
        }
    };
    const service = ctx.userQuestions;
    if (typeof service.registerProvider === 'function') {
        service.registerProvider(provider);
    }
    else {
        // DSH 0.1.3 routes answers through a scoped waterfall. The listener
        // belongs to this plugin's fiber, just like the legacy registration.
        const on = ctx.on.bind(ctx);
        on('user-questions/request', provider.ask);
    }
}
export const name = 'scripted-answers';
// Cordis plugin metadata: the provider requires the host user-questions service.
apply.inject = ['userQuestions'];
export { apply as default };
//# sourceMappingURL=scripted-provider.js.map