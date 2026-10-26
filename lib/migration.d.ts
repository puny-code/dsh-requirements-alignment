import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
/** Frozen legacy contract: never substitute a v2 header or handle for this API. */
interface SessionHeader {
    version: number;
    id: SessionId;
    createdAt: number;
    delegationDepth: number;
    cwd?: string;
    parentSession?: SessionId;
    seedLength?: number;
    origin?: 'subagent';
    agentPreset?: string;
}
/** Physical encoding of one artifact, from its filename suffix. */
export type ArtifactCompression = 'zstd' | 'none';
/** Byte range of one structurally complete Zstandard frame. */
export interface ZstdFrameRange {
    start: number;
    end: number;
}
/**
 * Structural scan of a concatenated Zstandard stream: locate complete frames
 * by walking the frame header and block headers (magic, FHD flags, window
 * descriptor, optional dict id / frame content size, block size fields, and
 * the 4-byte content checksum when flagged). Invalid complete structure
 * rejects; EOF inside a frame reports its start as a torn tail.
 */
export declare function scanZstdFrames(buffer: Buffer, maxFrames?: number): {
    frames: ZstdFrameRange[];
    tornStart?: number;
};
/** Decompress every complete frame and concatenate the plaintext. */
export declare function decompressZstdFrames(buffer: Buffer): Promise<string>;
/** Compress one checksummed Zstandard frame (the backend's frame format). */
export declare function compressZstdFrame(input: string | Buffer): Promise<Buffer>;
/** The session artifact path the JSONL backend resolves for a session. */
export declare function artifactPathFor(root: string, cwd: string | undefined, id: string, compression: ArtifactCompression): string;
/** Detect the artifact encoding from its file name. */
export declare function compressionOf(filename: string): ArtifactCompression | undefined;
/** Structural header validation mirroring the DSH JSONL backend's `isHeaderLine`. */
export declare function parseAndValidateHeaderLine(line: string): SessionHeader;
/**
 * Repair one parsed event record: whitelisted alignment events that do not
 * carry `ignorable: true` yet get it; everything else is returned unchanged.
 */
export declare function repairEventEnvelope(record: Record<string, unknown>): Record<string, unknown>;
/** A parsed artifact: header line + ordered event lines + the expanded logical events. */
export interface ParsedArtifact {
    header: SessionHeader;
    headerLine: string;
    /** The event lines in order (packed rows included, verbatim). */
    lines: string[];
    /** The expanded logical events (packed rows expanded via the DSH decoder). */
    events: SessionEvent[];
}
/** Parse artifact text: validate the header and every line, expand packed rows. */
export declare function parseArtifactText(text: string): ParsedArtifact;
/**
 * The services the migration needs: the persistence seam plus an optional
 * live-session registry for the no-live-writer gate.
 */
export interface MigrationServices {
    /** The session persistence service (`ctx.sessionPersistence`). */
    persistence: object;
    /** The live session store (`ctx.sessions`), when mounted. */
    sessions?: {
        get(id: SessionId): unknown;
    };
}
/** The result of one migration run. */
export interface MigrationReport {
    /** The migrated session id. */
    id: string;
    /** Absolute path of the (possibly replaced) artifact. */
    artifactPath: string;
    /** Physical encoding of the artifact. */
    compression: ArtifactCompression;
    /** SHA-256 of the ORIGINAL artifact bytes (before replacement). */
    originalSha256: string;
    /** Absolute path of the byte-for-byte backup of the original. */
    backupPath?: string;
    /** How many legacy alignment events gained `ignorable: true`. */
    repairedEvents: number;
    /** False when the artifact needed no repair (idempotent no-op). */
    migrated: boolean;
    /** The validated session header. */
    header: SessionHeader;
    /**
     * When the repaired artifact still refuses to load because of an
     * UNRELATED unknown event (out of the legacy alignment vocabulary), the
     * reader's refusal message. The repair itself succeeded — the foreign
     * event is out of scope and must be handled by its owning plugin.
     */
    foreignRefusal?: string;
}
/**
 * Migrate one session artifact (explicit, gated, idempotent). The original
 * file is replaced ONLY when every safety gate passes; any failure leaves it
 * byte-identical.
 *
 * @param id The persisted session id to repair.
 * @param services Persistence seam + optional live-session guard.
 * @param options Optional behavior switches.
 * @throws When any gate fails (original untouched), when the session has no
 *   materialized artifact, or when the session is currently live.
 */
export declare function migrateLegacyArtifact(id: SessionId, services: MigrationServices, options?: {
    signal?: AbortSignal;
}): Promise<MigrationReport>;
export default migrateLegacyArtifact;
//# sourceMappingURL=migration.d.ts.map