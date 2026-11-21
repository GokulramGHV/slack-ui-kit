import { describe, expect, it } from "vitest";
import { MemoryCardStore } from "../src/store.js";
import type { CardRecord } from "../src/types.js";

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  channel: "C1",
  ts: "1700000000.000001",
  owner: "U1",
  access: {},
  trusted: false,
  kind: "openui",
  source: 'root = Root([])',
  state: {},
  blocks: [],
  controls: {},
  forms: {},
  version: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  ...over,
});

describe("MemoryCardStore", () => {
  it("returns undefined for an unknown card", async () => {
    expect(await new MemoryCardStore().get("C1", "1.0")).toBeUndefined();
  });

  it("saves a new card when no version is expected", async () => {
    const store = new MemoryCardStore();
    expect(await store.put(card(), null)).toBe(true);
    expect(await store.get("C1", "1700000000.000001")).toEqual(card());
  });

  it("refuses to insert a card that already exists", async () => {
    const store = new MemoryCardStore();
    await store.put(card(), null);
    expect(await store.put(card({ owner: "U2" }), null)).toBe(false);
    expect((await store.get("C1", "1700000000.000001"))!.owner).toBe("U1");
  });

  it("saves when the stored version matches, and refuses a stale save", async () => {
    const store = new MemoryCardStore();
    await store.put(card(), null);
    expect(await store.put(card({ version: 2, state: { a: 1 } }), 1)).toBe(true);
    expect(await store.put(card({ version: 2, state: { a: 2 } }), 1)).toBe(false);
    expect((await store.get("C1", "1700000000.000001"))!.state).toEqual({ a: 1 });
  });

  it("refuses an update for a card it doesn't have", async () => {
    expect(await new MemoryCardStore().put(card({ version: 2 }), 1)).toBe(false);
  });

  it("keeps its own copy, so callers can't change stored cards by accident", async () => {
    const store = new MemoryCardStore();
    const c = card();
    await store.put(c, null);
    c.state.x = 1;
    const got = (await store.get("C1", c.ts))!;
    got.state.y = 2;
    expect((await store.get("C1", c.ts))!.state).toEqual({});
  });

  it("keeps cards in different channels apart", async () => {
    const store = new MemoryCardStore();
    await store.put(card(), null);
    expect(await store.get("C2", "1700000000.000001")).toBeUndefined();
  });
});
