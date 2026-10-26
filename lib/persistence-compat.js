/** Refuse legacy in-place writes before importing a retired host codec. */
export function assertLegacyMigrationHost(persistence) {
    if ('open' in persistence || !('readRaw' in persistence)
        || typeof persistence.readRaw !== 'function' || !('locate' in persistence)
        || typeof persistence.locate !== 'function') {
        throw new Error('migration: this host uses SessionHandle/immutable generations; legacy in-place repair is unsupported. No session artifact was read or changed.');
    }
}
//# sourceMappingURL=persistence-compat.js.map