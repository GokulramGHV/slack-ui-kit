import type { CardRecord, CardStore } from "./types.js";
/**
 * Keeps cards in memory. Good for tests and simple bots; cards are lost when
 * the process restarts. Stores and returns copies.
 */
export declare class MemoryCardStore implements CardStore {
    private cards;
    private key;
    get(channel: string, ts: string): Promise<CardRecord | undefined>;
    put(card: CardRecord, expectedVersion: number | null): Promise<boolean>;
}
