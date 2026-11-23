import { describe, expect, it } from "vitest";
import { createSlackKit, type SlackKitOptions } from "../src/kit.js";
import type { CardEvent } from "../src/types.js";
import { fakeClient } from "./helpers/fake-client.js";

const target = { channel: "C1" };
const now = () => new Date("2026-11-22T10:00:00.000Z");

function setup(opts: SlackKitOptions = {}) {
  const events: CardEvent[] = [];
  const kit = createSlackKit({ now, quiet: true, onEvent: (e) => void events.push(e), ...opts });
  return { kit, client: fakeClient(), events };
}

const click = (ts: string, user: string, action: any, extra: Record<string, unknown> = {}) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "t",
  actions: [action],
  ...extra,
});
const pick = (ts: string, id: string, value: string) =>
  click(ts, "U1", { type: "radio_buttons", action_id: id, selected_option: { value } });
const press = (ts: string, extra: Record<string, unknown> = {}) =>
  click(ts, "U1", { type: "button", action_id: "send", text: { type: "plain_text", text: "Send" } }, extra);
const methods = (c: ReturnType<typeof fakeClient>) => c.calls.map((x) => x.method);

describe("initial state on postCard", () => {
  const TEMPLATE = `$title = ""
root = Root([Header($title), Actions([go])])
go = Button("Go", Action([@Set($done, "yes")]))`;

  it("renders the given state, saves it, and keeps it through a click (both paths)", async () => {
    for (const placeholder of [false, true]) {
      const { kit, client } = setup();
      const { card, ts } = await kit.postCard(client, target, TEMPLATE, { owner: "U1", placeholder, state: { title: "Hi" } });
      expect(card.state.$title).toBe("Hi");
      expect(JSON.stringify(card.blocks)).toContain('"Hi"');
      expect((await kit.getCard("C1", ts))!.state.$title).toBe("Hi");
      await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }));
      const after = (await kit.getCard("C1", ts))!;
      expect(after.state).toMatchObject({ $title: "Hi", $done: "yes" });
      expect(JSON.stringify(after.blocks)).toContain('"Hi"');
    }
  });

  it("also takes keys that already carry a dollar sign", async () => {
    const { kit, client } = setup();
    const { card } = await kit.postCard(client, target, TEMPLATE, { owner: "U1", placeholder: false, state: { $title: "Yo" } });
    expect(card.state.$title).toBe("Yo");
  });
});

describe("required answers before a lock", () => {
  const CARD = `root = Root([q1, q2, acts])
$one = ""
$two = ""
q1 = Radio("First", $one, [Option("a", "A", "Alpha"), Option("b", "B")])
q2 = Radio("Second", $two, [Option("c", "C"), Option("d", "D")])
acts = Actions([send])
send = Button("Send", Action([@Set($sent, "yes")]))`;

  const post = (kit: any, client: any, required: string[][]) =>
    kit.postCard(client, target, CARD, { owner: "U1", placeholder: false, required });

  it("saves the groups on the card", async () => {
    const { kit, client } = setup();
    const { card } = await post(kit, client, [["one"], ["two"]]);
    expect(card.required).toEqual([["one"], ["two"]]);
    expect((await kit.postCard(client, target, CARD, { owner: "U1", placeholder: false })).card.required).toBeUndefined();
  });

  it("refuses the lock while a group is empty: no lock, no event, ephemeral, redraw", async () => {
    const { kit, client, events } = setup();
    const { ts } = await post(kit, client, [["one"], ["two"]]);
    await kit.handleAction(client, pick(ts, "q1", "a"));
    client.calls.length = 0;
    const r: any = await kit.handleAction(client, press(ts));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeUndefined();
    expect(card.version).toBe(2);
    expect(events).toEqual([]);
    expect(r.event).toBeUndefined();
    expect(methods(client)).toEqual(["chat.postEphemeral", "chat.update"]);
    expect(client.calls[0]!.args.text).toBe("Please answer every question first.");
    expect(card.state.$sent).not.toBe("yes");
  });

  it("lets an input change through without any check", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, [["one"], ["two"]]);
    await kit.handleAction(client, pick(ts, "q1", "a"));
    expect((await kit.getCard("C1", ts))!.state.$one).toBe("a");
    expect(methods(client)).toEqual(["chat.postMessage", "chat.update"]);
  });

  it("allows the lock once every group has an answer", async () => {
    const { kit, client, events } = setup();
    const { ts } = await post(kit, client, [["one"], ["two"]]);
    await kit.handleAction(client, pick(ts, "q1", "a"));
    await kit.handleAction(client, pick(ts, "q2", "d"));
    await kit.handleAction(client, press(ts));
    expect((await kit.getCard("C1", ts))!.locked).toMatchObject({ by: "U1", label: "Send" });
    expect(events).toHaveLength(1);
  });

  it("takes a group of two variables as met by the second", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, [["one", "two"]]);
    await kit.handleAction(client, press(ts));
    expect((await kit.getCard("C1", ts))!.locked).toBeUndefined();
    await kit.handleAction(client, pick(ts, "q2", "c"));
    await kit.handleAction(client, press(ts));
    expect((await kit.getCard("C1", ts))!.locked).toBeDefined();
  });

  it("counts a pick sent in the same payload as the press", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, [["one"]]);
    const state = { values: { blk: { q1: { type: "radio_buttons", selected_option: { value: "b" } } } } };
    await kit.handleAction(client, press(ts, { state }));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeDefined();
    expect(card.state.$one).toBe("b");
  });

  it("counts what the press itself sets", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, [["sent"]]);
    await kit.handleAction(client, press(ts));
    expect((await kit.getCard("C1", ts))!.locked).toBeDefined();
  });

  it("treats blank text and empty lists as unanswered, and uses the host's message", async () => {
    const src = `root = Root([Actions([box, send])])
$t = "  "
$l = []
box = Checkboxes("L", $l, [Option("x", "X")])
send = Button("Send", Action([@Set($sent, "yes")]))`;
    const { kit, client } = setup({ messages: { answerFirst: "Answer first." } });
    const { ts } = await kit.postCard(client, target, src, { owner: "U1", placeholder: false, required: [["t"], ["l"]] });
    client.calls.length = 0;
    await kit.handleAction(client, press(ts));
    expect(client.calls[0]!.args.text).toBe("Answer first.");
    expect((await kit.getCard("C1", ts))!.locked).toBeUndefined();
  });

  it("saves text that arrives only with a refused press, keeps it on screen, and locks on the next press", async () => {
    const src = `root = Root([tb, q, Actions([send])])
$note = ""
$pick = ""
tb = TextBox("Other", $note)
q = Radio("Pick", $pick, [Option("a", "A"), Option("b", "B")])
send = Button("Send", Action([@Set($sent, "yes")]))`;
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, src, { owner: "U1", placeholder: false, required: [["note"], ["pick"]] });
    client.calls.length = 0;
    const state = { values: { blk: { tb: { type: "plain_text_input", value: "typed" } } } };
    await kit.handleAction(client, press(ts, { state }));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeUndefined();
    expect(card.state.$note).toBe("typed");
    expect(events).toEqual([]);
    expect(methods(client)).toEqual(["chat.postEphemeral", "chat.update"]);
    expect(JSON.stringify(client.calls[1]!.args.blocks)).toContain("typed");
    expect(JSON.stringify(card.blocks)).toContain("typed");
    await kit.handleAction(client, pick(ts, "q", "a"));
    await kit.handleAction(client, press(ts));
    const done = (await kit.getCard("C1", ts))!;
    expect(done.locked).toBeDefined();
    expect(done.state.$note).toBe("typed");
    expect(events).toHaveLength(1);
  });

  it("renders with bare state keys through kit.render", async () => {
    const { kit } = setup();
    const r = await kit.render(`$title = ""\nroot = Root([Header($title)])`, { title: "Hi" });
    expect(r.state.$title).toBe("Hi");
  });

  describe("form submits", () => {
    const FORM = `root = Root([Form("Note", "Save", [TextInput("Note", $comment)])])
$comment = ""`;
    const open = async (kit: any, client: any, ts: string) => {
      await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "form:Form_0" }));
      return client.calls.find((c: any) => c.method === "views.open")?.args.view;
    };
    const submission = (view: any, value: string) => ({
      type: "view_submission",
      user: { id: "U1" },
      view: { ...view, state: { values: { [view.blocks[0].block_id]: { [view.blocks[0].element.action_id]: { type: "plain_text_input", value } } } } },
    });

    it("answers with a field error while the group is empty, then locks once filled", async () => {
      const { kit, client, events } = setup();
      const { card, ts } = await kit.postCard(client, target, FORM, { owner: "U1", placeholder: false, required: [["comment"]] });
      const formId = Object.keys(card.forms)[0]!;
      await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: `form:${formId}` }));
      const view = client.calls.find((c) => c.method === "views.open")!.args.view;
      const r: any = await kit.handleViewSubmission(client, submission(view, "   "));
      expect(r.response).toEqual({ response_action: "errors", errors: { [view.blocks[0].block_id]: "Please answer every question first." } });
      await r.done;
      expect((await kit.getCard("C1", ts))!.locked).toBeUndefined();
      expect(events).toEqual([]);
      const ok: any = await kit.handleViewSubmission(client, submission(view, "fine"));
      expect(ok.response).toBeUndefined();
      await ok.done;
      expect((await kit.getCard("C1", ts))!.locked).toBeDefined();
      expect(events).toHaveLength(1);
    });
  });
});
