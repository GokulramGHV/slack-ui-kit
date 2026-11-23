import { describe, expect, it } from "vitest";
import { clickFromAction, clickFromSubmission } from "../src/decide.js";
import { createSlackKit } from "../src/kit.js";
import type { CardEvent } from "../src/types.js";
import { fakeClient, once } from "./helpers/fake-client.js";
import { SAMPLE_CARD } from "./helpers/sample.js";

const opt = (value: string, text: string) => ({ value, text: { type: "plain_text", text } });
const meta = { callbackId: "kit_form", unwrapMeta: (s: string) => JSON.parse(s) };

const submission = (values: Record<string, Record<string, unknown>>) => ({
  user: { id: "U1" },
  view: {
    callback_id: "kit_form",
    private_metadata: JSON.stringify({ channel: "C1", ts: "1.1", formId: "f" }),
    state: { values },
  },
});

describe("control.labels", () => {
  it("form submit: labels for choice fields only, keyed like the values", () => {
    const r = clickFromSubmission(
      submission({
        b1: { $size: { type: "static_select", selected_option: opt("m", "Medium") } },
        b2: { $toppings: { type: "multi_static_select", selected_options: [opt("a", "Almonds"), opt("c", "Cocoa")] } },
        b3: { $note: { type: "plain_text_input", value: "hi" } },
        b4: { $when: { type: "datepicker", selected_date: "2026-11-23" } },
      }),
      meta,
    )!;
    expect(r.click.submit!.values).toEqual({ $size: "m", $toppings: ["a", "c"], $note: "hi", $when: "2026-11-23" });
    expect(r.click.labels).toEqual({ $size: "Medium", $toppings: ["Almonds", "Cocoa"] });
    expect(Object.keys(r.click.labels!).every((k) => k in r.click.submit!.values)).toBe(true);
  });

  it("form submit: no labels when no choice field was filled", () => {
    const r = clickFromSubmission(submission({ b1: { $note: { type: "plain_text_input", value: "hi" } } }), meta)!;
    expect(r.click.labels).toBeUndefined();
  });

  it("radio click: labels keyed by the control id", () => {
    const r = clickFromAction({
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.1" },
      actions: [{ type: "radio_buttons", action_id: "size", selected_option: opt("l", "Large") }],
    })!;
    expect(r.click.value).toBe("l");
    expect(r.click.labels).toEqual({ size: "Large" });
  });

  it("button press: no labels", () => {
    const r = clickFromAction({
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.1" },
      actions: [{ type: "button", action_id: "go", value: "x", text: { type: "plain_text", text: "Go" } }],
    })!;
    expect(r.click.labels).toBeUndefined();
  });

  it("reaches the event: checkbox click carries labels, button does not", async () => {
    const events: CardEvent[] = [];
    const kit = createSlackKit({ quiet: true, events: "all", onEvent: (e) => void events.push(e) });
    const client = fakeClient();
    const { ts } = await kit.postCard(client, { channel: "C1" }, once(SAMPLE_CARD), { owner: "U1", access: { inputs: "anyone" } });
    const base = { type: "block_actions", user: { id: "U1" }, channel: { id: "C1" }, message: { ts }, trigger_id: "t" };
    await kit.handleAction(client, { ...base, actions: [{ type: "checkboxes", action_id: "pick", selected_options: [opt("a", "Alpha")] }] });
    expect(events.at(-1)!.control.labels).toEqual({ pick: ["Alpha"] });
    await kit.handleAction(client, { ...base, actions: [{ type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }] });
    const last = events.at(-1)!;
    expect(last.control.id).toBe("go");
    expect("labels" in last.control).toBe(false);
  });

  it("overflow click: labels keyed by the control id", () => {
    const r = clickFromAction({
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.1" },
      actions: [{ type: "overflow", action_id: "more", selected_option: opt("x", "Export") }],
    })!;
    expect(r.click.labels).toEqual({ more: "Export" });
  });
});

describe("event.stateLabels", () => {
  const CARD = `root = Root([size, tags, acts])
$size = ""
$tags = []
$done = ""
size = Radio("Size", $size, [Option("s", "Small"), Option("l", "Large")])
tags = Checkboxes("Tags", $tags, [Option("a", "Alpha"), Option("b", "Beta")])
acts = Actions([ok])
ok = Button("Confirm", Action([@Set($done, "yes")]), "primary")`;
  const base = (ts: string) => ({ type: "block_actions", user: { id: "U1" }, channel: { id: "C1" }, message: { ts }, trigger_id: "t" });

  async function setup(source = CARD, trusted = false) {
    const events: CardEvent[] = [];
    const kit = createSlackKit({ quiet: true, onEvent: (e) => void events.push(e) });
    const client = fakeClient();
    const { ts } = await kit.postCard(client, { channel: "C1" }, once(source), { owner: "U1", access: { inputs: "anyone" }, trusted });
    return { kit, client, events, ts };
  }
  const pick = (ts: string, id: string, selected: any) =>
    ({ ...base(ts), actions: [{ action_id: id, ...selected }] });

  it("a button press reports the shown text of choices made earlier", async () => {
    const { kit, client, events, ts } = await setup();
    await kit.handleAction(client, pick(ts, "size", { type: "radio_buttons", selected_option: opt("l", "Large") }));
    await kit.handleAction(client, pick(ts, "tags", { type: "checkboxes", selected_options: [opt("b", "Beta"), opt("a", "Alpha")] }));
    await kit.handleAction(client, { ...base(ts), actions: [{ type: "button", action_id: "ok", text: { type: "plain_text", text: "Confirm" } }] });
    const e = events.at(-1)!;
    expect(e.state).toMatchObject({ $size: "l", $tags: ["b", "a"] });
    expect(e.stateLabels).toEqual({ $size: "Large", $tags: ["Beta", "Alpha"] });
    expect("labels" in e.control).toBe(false);
  });

  it("leaves out a value that matches no option, and the field when nothing matches", async () => {
    const { kit, client, events, ts } = await setup(CARD.replace('$size = ""', '$size = "xl"'));
    await kit.handleAction(client, { ...base(ts), actions: [{ type: "button", action_id: "ok", text: { type: "plain_text", text: "Confirm" } }] });
    expect(events.at(-1)!.stateLabels).toBeUndefined();
    expect("stateLabels" in events.at(-1)!).toBe(false);
  });

  it("raw-block cards have no stateLabels", async () => {
    const events: CardEvent[] = [];
    const kit = createSlackKit({ quiet: true, onEvent: (e) => void events.push(e) });
    const client = fakeClient();
    const blocks = [{ type: "actions", elements: [{ type: "button", action_id: "ack", text: { type: "plain_text", text: "Ack" } }] }];
    await kit.registerCard({ channel: "C1", ts: "5.5", blocks, owner: "U1" });
    await kit.handleAction(client, { ...base("5.5"), actions: [{ type: "button", action_id: "ack", text: { type: "plain_text", text: "Ack" } }] });
    expect(events).toHaveLength(1);
    expect("stateLabels" in events[0]!).toBe(false);
  });
});
