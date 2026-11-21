import { describe, expect, it } from "vitest";
import { applyDecision, newOpenUICard } from "../src/apply.js";
import { createCardEngine, extendLibrary } from "../src/openui/index.js";
import type { CardRecord } from "../src/types.js";
import { SAMPLE_CARD } from "./helpers/sample.js";

const engine = createCardEngine(extendLibrary());
const now = () => new Date("2026-11-22T10:00:00.000Z");

async function sampleCard(over: Partial<CardRecord> = {}): Promise<CardRecord> {
  const render = await engine.renderState(SAMPLE_CARD);
  return { ...newOpenUICard({ channel: "C1", ts: "1.1", owner: "U1", source: SAMPLE_CARD, render, now }), ...over };
}

describe("newOpenUICard", () => {
  it("records blocks, state, controls and form specs from the render", async () => {
    const card = await sampleCard();
    expect(card).toMatchObject({ kind: "openui", trusted: false, version: 1, access: {}, createdAt: "2026-11-22T10:00:00.000Z" });
    expect(card.controls).toEqual({ pick: "input", go: "button", stop: "button", "form:note": "form" });
    expect(Object.keys(card.forms)).toEqual(["note"]);
    expect(card.state).toMatchObject({ $picks: ["alpha"], $decision: "" });
    expect(card.blocks.map((b) => b.type)).toEqual(["header", "section", "actions", "actions", "actions"]);
    expect(structuredClone(card)).toEqual(card); // must survive any store
  });
});

describe("applyDecision", () => {
  it("applies an input change to the state and blocks, without locking", async () => {
    const card = await sampleCard();
    const next = await applyDecision(card, {
      type: "apply",
      kind: "input",
      lock: false,
      notify: false,
      click: { user: "U1", actionId: "pick", value: ["alpha", "beta"] },
    }, { engine, now });
    expect(next.state.$picks).toEqual(["alpha", "beta"]);
    expect(next.version).toBe(2);
    expect(next.locked).toBeUndefined();
    const checkboxes = next.blocks[2]!.elements[0];
    expect(checkboxes.initial_options.map((o: any) => o.value)).toEqual(["alpha", "beta"]);
  });

  it("runs a button's action and freezes the card", async () => {
    const card = await sampleCard();
    const next = await applyDecision(card, {
      type: "apply",
      kind: "button",
      lock: true,
      notify: true,
      click: { user: "U1", actionId: "go", label: "Go" },
    }, { engine, now });
    expect(next.state.$decision).toBe("go");
    expect(next.locked).toEqual({ by: "U1", at: "2026-11-22T10:00:00.000Z", label: "Go" });
    expect(next.blocks.some((b) => b.type === "actions")).toBe(false);
    expect(next.blocks.at(-1)!.elements[0].text).toMatch(/^Go pressed by <@U1> at /);
  });

  it("applies a form submit's values", async () => {
    const card = await sampleCard();
    const next = await applyDecision(card, {
      type: "apply",
      kind: "form",
      lock: false,
      notify: true,
      click: { user: "U1", actionId: "form:note", submit: { formId: "note", values: { $comment: "hi" } } },
    }, { engine, now });
    expect(next.state.$comment).toBe("hi");
  });

  it("leaves raw-block cards' blocks alone unless the click locks", async () => {
    const blocks = [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Ack" }, action_id: "ack" }] }];
    const card: CardRecord = { ...(await sampleCard()), kind: "blocks", source: undefined, blocks, controls: { ack: "button" } };
    const kept = await applyDecision(card, { type: "apply", kind: "button", lock: false, notify: true, click: { user: "U1", actionId: "ack" } }, { now });
    expect(kept.blocks).toEqual(blocks);
    const locked = await applyDecision(card, { type: "apply", kind: "button", lock: true, notify: true, click: { user: "U1", actionId: "ack", label: "Ack" } }, { now });
    expect(locked.blocks).toEqual([locked.blocks[0]]);
    expect(locked.blocks[0]!.elements[0].text).toMatch(/^Ack pressed by <@U1>/);
  });
});
