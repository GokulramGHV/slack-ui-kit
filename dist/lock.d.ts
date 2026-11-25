import type { Block } from "./sanitize.js";
import type { LockInfo } from "./types.js";
/** Slack date token, so each reader sees their own local time. */
export declare function dateToken(iso: string): string;
/** Blocks with every live control replaced by what was chosen. Link buttons and feedback stay. */
export declare function freeze(blocks: readonly Block[]): Block[];
/**
 * A card frozen after a submit-style click: buttons and inputs are replaced
 * with what was chosen, link buttons and feedback buttons stay, and a footer
 * says who did it and when.
 */
export declare function lockedBlocks(blocks: readonly Block[], lock: LockInfo, opts?: {
    note?: string;
    closedNote?: string;
}): Block[];
