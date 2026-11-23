import { describe, expect, it } from "vitest";
import { createSlackKit, type SlackKitOptions } from "../src/kit.js";
import { decodePlainText, sanitize } from "../src/sanitize.js";
import type { CardEvent } from "../src/types.js";
import { fakeClient } from "./helpers/fake-client.js";

const target = { channel: "C1" };
const now = () => new Date("2026-11-22T10:00:00.000Z");

function setup(opts: SlackKitOptions = {}) {
  const events: CardEvent[] = [];
  const kit = createSlackKit({ now, quiet: true, onEvent: (e) => void events.push(e), ...opts });
  return { kit, client: fakeClient(), events };
}

const click = (ts: string, user: string, action: any) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "t",
  actions: [action],
});

describe("refused form submit keeps what was typed", () => {
  const FORM = `root = Root([Form("Note", "Save", [TextInput("Name", $name), TextInput("Note", $comment)])])
$name = ""
$comment = ""`;
  const fields = (view: any) => view.blocks.filter((b: any) => b.type === "input");
  const submission = (view: any, values: string[], user = "U1") => ({
    type: "view_submission",
    user: { id: user },
    view: {
      ...view,
      state: {
        values: Object.fromEntries(
          fields(view).map((b: any, i: number) => [b.block_id, { [b.element.action_id]: { type: "plain_text_input", value: values[i] } }]),
        ),
      },
    },
  });
  const open = async (kit: any, client: any, ts: string, formId: string) => {
    client.calls.length = 0;
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: `form:${formId}` }));
    return client.calls.find((c: any) => c.method === "views.open")!.args.view;
  };

  it("saves the typed values on a required refusal, prefills the reopened form, then a full submit locks", async () => {
    const { kit, client, events } = setup();
    const { card, ts } = await kit.postCard(client, target, FORM, { owner: "U1", placeholder: false, required: [["comment"]] });
    const formId = Object.keys(card.forms)[0]!;
    const view = await open(kit, client, ts, formId);
    const r: any = await kit.handleViewSubmission(client, submission(view, ["Ada", ""]));
    expect(r.response.response_action).toBe("errors");
    await r.done;
    const stored = (await kit.getCard("C1", ts))!;
    expect(stored.locked).toBeUndefined();
    expect(stored.state).toMatchObject({ $name: "Ada", $comment: "" });
    expect(stored.version).toBe(card.version + 1);
    expect(events).toEqual([]);

    const again = await open(kit, client, ts, formId);
    expect(fields(again)[0].element.initial_value).toBe("Ada");

    const ok: any = await kit.handleViewSubmission(client, submission(again, ["Ada", "hello"]));
    expect(ok.response).toBeUndefined();
    await ok.done;
    expect((await kit.getCard("C1", ts))!.locked).toBeDefined();
    expect(events).toHaveLength(1);
  });

  it("saves nothing when the submitter fails the access check", async () => {
    const { kit, client } = setup();
    const { card, ts } = await kit.postCard(client, target, FORM, { owner: "U1", placeholder: false, required: [["comment"]] });
    const view = await open(kit, client, ts, Object.keys(card.forms)[0]!);
    const r: any = await kit.handleViewSubmission(client, submission(view, ["Eve", ""], "U9"));
    expect(r.response.response_action).toBe("errors");
    await r.done;
    const stored = (await kit.getCard("C1", ts))!;
    expect(stored.state.$name).toBe("");
    expect(stored.version).toBe(card.version);
  });
});

describe("closeCard", () => {
  const CARD = `root = Root([Header("Pick"), Radio("Size", $size, [Option("s", "Small"), Option("l", "Large")]), Actions([go])])
$size = ""
go = Button("Go", Action([@Set($done, "yes")]))`;

  it("locks an open card without an event, with the note as footer", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, CARD, { owner: "U1", placeholder: false, state: { size: "l" } });
    client.calls.length = 0;
    expect(await kit.closeCard(client, "C1", ts, { note: "Replaced by a newer question." })).toBe(true);
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toMatchObject({ note: "Replaced by a newer question." });
    expect(card.version).toBe(2);
    const text = JSON.stringify(card.blocks);
    expect(text).toContain("*Chosen:* Large");
    expect(text).toContain("Large");
    expect(text).toContain("Replaced by a newer question.");
    expect(text).not.toContain("pressed by");
    expect(card.blocks.some((b) => JSON.stringify(b).includes("radio_buttons"))).toBe(false);
    expect(client.calls.map((c) => c.method)).toEqual(["chat.update"]);
    expect(events).toEqual([]);

    // Clicks on it behave like any locked card.
    client.calls.length = 0;
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }));
    expect(client.calls[0]!.method).toBe("chat.postEphemeral");
    expect(events).toEqual([]);
  });

  it("returns false for a missing or already locked card, and writes nothing", async () => {
    const { kit, client } = setup();
    expect(await kit.closeCard(client, "C1", "9.9", { note: "x" })).toBe(false);
    const { ts } = await kit.postCard(client, target, CARD, { owner: "U1", placeholder: false });
    await kit.closeCard(client, "C1", ts, { note: "x" });
    client.calls.length = 0;
    expect(await kit.closeCard(client, "C1", ts, { note: "y" })).toBe(false);
    expect(client.calls).toEqual([]);
    expect(JSON.stringify((await kit.getCard("C1", ts))!.blocks)).not.toContain('"y"');
  });
});

describe("entities in plain text", () => {
  const pt = (text: string) => ({ type: "plain_text", text });

  it("decodes plain_text only, in order, once", () => {
    const out: any = decodePlainText([
      { type: "section", text: { type: "mrkdwn", text: "Fish &amp; Chips" }, accessory: { type: "button", text: pt("A &lt;b&gt; &amp;amp;") } },
    ]);
    expect(out[0].text.text).toBe("Fish &amp; Chips");
    expect(out[0].accessory.text.text).toBe("A <b> &amp;");
  });

  it("sanitize alone leaves text as it is (decoding happens once per render)", () => {
    const out: any = sanitize([{ type: "header", text: pt("a &amp;amp; b") }]);
    expect(out[0].text.text).toBe("a &amp;amp; b");
  });

  const CARD = `$food = ""
root = Root([Section("Fish &amp; Chips"), Radio("Pick &amp; go", $food, [Option("fc", "Fish &amp; Chips", "Hot &lt;fresh&gt;"), Option("x", "Other")]), Actions([go])])
go = Button("Fish &amp; Go", Action([@Set($done, "yes")]))`;

  it("renders plain labels, keeps mrkdwn escaped, and gives plain stateLabels; the lock escapes for mrkdwn", async () => {
    const { kit, client, events } = setup();
    const { ts, card } = await kit.postCard(client, target, CARD, { owner: "U1", placeholder: false });
    const json = JSON.stringify(card.blocks);
    expect(json).toContain('"text":"Fish & Chips"');
    expect(json).toContain("Hot <fresh>");
    expect(json).toContain("Fish & Go");
    expect(json).toContain("Fish &amp; Chips"); // the mrkdwn Section
    const radioId = Object.keys(card.controls).find((id) => card.controls[id] === "input")!;
    await kit.handleAction(client, click(ts, "U1", { type: "radio_buttons", action_id: radioId, selected_option: { value: "fc", text: pt("Fish & Chips") } }));
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "go", text: pt("Fish & Go") }));
    expect(events.at(-1)!.stateLabels).toEqual({ $food: "Fish & Chips" });
    const locked = JSON.stringify((await kit.getCard("C1", ts))!.blocks);
    expect(locked).toContain("*Chosen:* Fish &amp; Chips");
  });

  it("raw cards are decoded too", async () => {
    const { kit } = setup();
    const card = await kit.registerCard({
      channel: "C1",
      ts: "1.1",
      blocks: [{ type: "actions", elements: [{ type: "button", action_id: "a", text: pt("Tom &amp; Jerry") }] }],
      owner: "U1",
    });
    expect(JSON.stringify(card.blocks)).toContain("Tom & Jerry");
  });
});

describe("decoded text never reaches mrkdwn or notification text raw", () => {
  const pt = (text: string) => ({ type: "plain_text", text });

  it("a button label <!channel> is escaped in the lock footer", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, `root = Root([Actions([go])])\ngo = Button("&lt;!channel&gt;", Action([@Set($done, "yes")]))`, { owner: "U1", placeholder: false });
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "go", text: pt("<!channel>") }));
    const footer = JSON.stringify((await kit.getCard("C1", ts))!.blocks);
    expect(footer).toContain("&lt;!channel&gt; pressed by");
    expect(footer).not.toContain("<!channel>");
  });

  it("the notification text of a card without a header keeps the escapes", async () => {
    const { kit, client } = setup();
    const SRC = `root = Root([Container("&lt;!channel&gt;", [Section("body")])])`;
    const { card } = await kit.postCard(client, target, SRC, { owner: "U1", placeholder: false });
    const sent = client.calls.find((c) => c.method === "chat.postMessage")!.args;
    expect(sent.text).not.toContain("<!channel>");
    expect(card.text).not.toContain("<!channel>");
  });

  it("a refused submit redraws the message from the saved state", async () => {
    const { kit, client } = setup();
    const FORM = `root = Root([Section($name), Form("Note", "Save", [TextInput("Name", $name), TextInput("Note", $comment)])])
$name = ""
$comment = ""`;
    const { card, ts } = await kit.postCard(client, target, FORM, { owner: "U1", placeholder: false, required: [["comment"]] });
    client.calls.length = 0;
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: `form:${Object.keys(card.forms)[0]}` }));
    const view = client.calls.find((c) => c.method === "views.open")!.args.view;
    const inputs = view.blocks.filter((b: any) => b.type === "input");
    const sub = {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        ...view,
        state: { values: Object.fromEntries(inputs.map((b: any, i: number) => [b.block_id, { [b.element.action_id]: { type: "plain_text_input", value: i === 0 ? "Ada" : "" } }])) },
      },
    };
    client.calls.length = 0;
    const r: any = await kit.handleViewSubmission(client, sub);
    await r.done;
    const update = client.calls.find((c) => c.method === "chat.update");
    expect(JSON.stringify(update?.args.blocks)).toContain("Ada");
  });
});
