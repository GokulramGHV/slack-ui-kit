/**
 * Keeps cards in memory. Good for tests and simple bots; cards are lost when
 * the process restarts. Stores and returns copies.
 */
export class MemoryCardStore {
    cards = new Map();
    key(channel, ts) {
        return `${channel}:${ts}`;
    }
    async get(channel, ts) {
        const card = this.cards.get(this.key(channel, ts));
        return card && structuredClone(card);
    }
    async put(card, expectedVersion) {
        const key = this.key(card.channel, card.ts);
        const stored = this.cards.get(key);
        if (expectedVersion === null ? stored !== undefined : stored?.version !== expectedVersion)
            return false;
        this.cards.set(key, structuredClone(card));
        return true;
    }
}
//# sourceMappingURL=store.js.map