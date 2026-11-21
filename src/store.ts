import type { CardRecord, CardStore } from "./types.js";

/**
 * Keeps cards in memory. Good for tests and simple bots; cards are lost when
 * the process restarts. Stores and returns copies.
 */
export class MemoryCardStore implements CardStore {
  private cards = new Map<string, CardRecord>();

  private key(channel: string, ts: string) {
    return `${channel}:${ts}`;
  }

  async get(channel: string, ts: string): Promise<CardRecord | undefined> {
    const card = this.cards.get(this.key(channel, ts));
    return card && structuredClone(card);
  }

  async put(card: CardRecord, expectedVersion: number | null): Promise<boolean> {
    const key = this.key(card.channel, card.ts);
    const stored = this.cards.get(key);
    if (expectedVersion === null ? stored !== undefined : stored?.version !== expectedVersion) return false;
    this.cards.set(key, structuredClone(card));
    return true;
  }
}
