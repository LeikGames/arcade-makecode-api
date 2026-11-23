/**
 * The high-score table and its storage.
 *
 * Stored in one setting as a binary buffer, little-endian:
 *   "LS", version, entry count,
 *   entries x 12 bytes: score uint32, initials 3 x uint16, player uint8, 0,
 *   uint16 checksum of everything before it.
 * Anything that doesn't validate reads as an empty table.
 */
namespace cabinet.internal.scores {
    export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789";
    export const INITIALS_LENGTH = 3;
    export const MAX_ENTRIES = 10;
    export const MAX_SCORE = 999999999;

    const KEY = "cabinet.scores";
    const VERSION = 1;
    const HEADER_SIZE = 4;
    const ENTRY_SIZE = 12;

    // The exported host page saves asynchronously, and loses a write that is
    // followed too closely by another write or a restart.
    const SAVE_SETTLE_MS = 500;

    let tableSize = MAX_ENTRIES;
    let lastWrite = -SAVE_SETTLE_MS;

    export class Entry {
        constructor(public initials: string, public score: number, public player: number) { }
    }

    export function setTableSize(size: number): void {
        tableSize = Math.clamp(1, MAX_ENTRIES, Math.floor(size));
    }

    /** A score as it is ranked, stored and reported: an integer from 0 to MAX_SCORE. */
    export function normalize(score: number): number {
        // NaN and undefined fail the comparison
        return score > 0 ? Math.min(MAX_SCORE, Math.floor(score)) : 0;
    }

    /** Best first. */
    export function load(): Entry[] {
        return decode(settings.readBuffer(KEY)).slice(0, tableSize);
    }

    /** The 0-based place a score would take, or -1 if it doesn't make the table. */
    export function rankOf(score: number): number {
        if (score <= 0) return -1;
        const entries = load();
        let rank = 0;
        while (rank < entries.length && entries[rank].score >= score) rank++;
        return rank < tableSize ? rank : -1;
    }

    /** Adds and saves an entry. Returns its place, or -1 if it didn't make the table. */
    export function add(entry: Entry): number {
        const rank = rankOf(entry.score);
        if (rank < 0) return -1;
        const entries = load();
        entries.insertAt(rank, entry);
        settings.writeBuffer(KEY, encode(entries.slice(0, tableSize)));
        noteWrite();
        return rank;
    }

    export function reset(): void {
        settings.remove(KEY);
        noteWrite();
    }

    export function noteWrite(): void {
        lastWrite = control.millis();
    }

    /** Waits until the last write is safe from another write, a restart or a quit. */
    export function settle(): void {
        pauseUntil(() => control.millis() - lastWrite >= SAVE_SETTLE_MS);
    }

    function encode(entries: Entry[]): Buffer {
        const size = HEADER_SIZE + entries.length * ENTRY_SIZE;
        const b = control.createBuffer(size + 2);
        b[0] = 0x4c;
        b[1] = 0x53;
        b[2] = VERSION;
        b[3] = entries.length;
        for (let i = 0; i < entries.length; i++) {
            const at = HEADER_SIZE + i * ENTRY_SIZE;
            b.setNumber(NumberFormat.UInt32LE, at, entries[i].score);
            for (let j = 0; j < INITIALS_LENGTH; j++)
                b.setNumber(NumberFormat.UInt16LE, at + 4 + j * 2, entries[i].initials.charCodeAt(j));
            b[at + 10] = entries[i].player;
        }
        b.setNumber(NumberFormat.UInt16LE, size, checksum(b, size));
        return b;
    }

    function decode(b: Buffer): Entry[] {
        if (!b || b.length < HEADER_SIZE + 2) return [];
        if (b[0] != 0x4c || b[1] != 0x53 || b[2] != VERSION) return [];
        const count = b[3];
        const size = HEADER_SIZE + count * ENTRY_SIZE;
        if (count > MAX_ENTRIES || b.length != size + 2) return [];
        if (b.getNumber(NumberFormat.UInt16LE, size) != checksum(b, size)) return [];

        const entries: Entry[] = [];
        let previous = MAX_SCORE;
        for (let i = 0; i < count; i++) {
            const at = HEADER_SIZE + i * ENTRY_SIZE;
            const score = b.getNumber(NumberFormat.UInt32LE, at);
            const player = b[at + 10];
            if (score < 1 || score > previous || (player != 1 && player != 2)) return [];
            previous = score;
            let initials = "";
            for (let j = 0; j < INITIALS_LENGTH; j++) {
                const c = String.fromCharCode(b.getNumber(NumberFormat.UInt16LE, at + 4 + j * 2));
                if (ALPHABET.indexOf(c) < 0) return [];
                initials += c;
            }
            entries.push(new Entry(initials, score, player));
        }
        return entries;
    }

    function checksum(b: Buffer, length: number): number {
        let sum = 0x5343;
        for (let i = 0; i < length; i++) sum = (sum * 31 + b[i]) & 0xffff;
        return sum;
    }
}
