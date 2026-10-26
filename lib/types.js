/** Legal mode names, used by the configuration schema and validation. */
export const ALIGNMENT_MODES = ['auto', 'manual', 'off'];
/** Narrow an unknown value to an {@link AlignmentMode}. */
export function isAlignmentMode(value) {
    return value === 'auto' || value === 'manual' || value === 'off';
}
/**
 * Validate an unknown mode, returning it narrowed. Throws on anything that is
 * not a legal {@link AlignmentMode} — the single validation used by config
 * resolution, ModeStore writes, and runtime transitions.
 */
export function validateAlignmentMode(value) {
    if (!isAlignmentMode(value)) {
        throw new Error(`requirements-alignment mode must be 'auto', 'manual', or 'off', got ${JSON.stringify(value)}`);
    }
    return value;
}
/** All supported drift reasons, for argument validation and status display. */
export const DRIFT_REASONS = [
    'scope-expansion',
    'constraint-conflict',
    'behavior-change',
    'architecture-shift',
    'data-model-change',
    'compatibility-change',
    'assumption-invalidated',
    'user-direction-change'
];
/**
 * The exact legacy alignment event vocabulary this plugin owns — the ONLY
 * types the migration tooling may ever touch. Everything else in a session
 * log is foreign and must remain byte-identical.
 */
export const LEGACY_ALIGNMENT_EVENT_TYPES = new Set([
    'alignment/status',
    'alignment/baseline',
    'alignment/baseline-updated',
    'alignment/drift',
    'alignment/decision',
    'alignment/manual-check'
]);
/** Whether an event type belongs to the legacy alignment vocabulary. */
export function isLegacyAlignmentEventType(type) {
    return LEGACY_ALIGNMENT_EVENT_TYPES.has(type);
}
//# sourceMappingURL=types.js.map