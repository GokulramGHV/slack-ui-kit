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
});
