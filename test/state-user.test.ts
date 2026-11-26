import { describe, expect, it } from "vitest";
import { createSlackKit, type SlackKitOptions } from "../src/kit.js";
import type { Access } from "../src/types.js";
import { fakeClient } from "./helpers/fake-client.js";

const target = { channel: "C1" };
const now = () => new Date("2026-11-22T10:00:00.000Z");
const setup = (opts: SlackKitOptions = {}) => ({ kit: createSlackKit({ now, quiet: true, ...opts }), client: fakeClient() });

const click = (ts: string, user: string, action: any, extra: Record<string, unknown> = {}) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "t",
  actions: [action],
  ...extra,
});
const press = (ts: string, user: string, id = "go", extra: Record<string, unknown> = {}) =>
  click(ts, user, { type: "button", action_id: id, text: { type: "plain_text", text: "Go" } }, extra);
const pickRadio = (ts: string, user: string, value: string) =>
  click(ts, user, { type: "radio_buttons", action_id: "pick", selected_option: { value } });

// "signer" is bound to inputs on purpose, to prove a click can't set it and then pass the check.
const CARD = `$signer = ""
$done = ""
root = Root([pick, acts, note])
pick = Radio("Pick", $signer, [Option("U2ABC", "A"), Option("U3ABC", "B")])
acts = Actions([go])
go = Button("Go", Action([@Set($done, "yes")]))
note = Form("Note", "Save", [TextInput("Note", $signer)])`;
const access: Access = { buttons: { stateUser: "signer" }, inputs: { stateUser: "signer" }, forms: { stateUser: "signer" } };

const post = (kit: any, client: any, over: Record<string, unknown> = {}) =>
  kit.postCard(client, target, CARD, { owner: "U1", placeholder: false, trusted: true, access, state: { signer: "U2ABC" }, ...over });

describe("stateUser through the kit", () => {
  it("lets the named user press and refuses the owner and others", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client);
    const denied: any = await kit.handleAction(client, press(ts, "U1"));
    expect(denied.decision).toMatchObject({ type: "deny", message: "Only <@U2ABC> can do this." });
    expect((await kit.handleAction(client, press(ts, "U3ABC")) as any).decision.type).toBe("deny");
    expect((await kit.getCard("C1", ts))!.locked).toBeUndefined();
    await kit.handleAction(client, press(ts, "U2ABC"));
    expect((await kit.getCard("C1", ts))!.locked).toMatchObject({ by: "U2ABC" });
  });

  it("decides on the state before the click: an input that would set the key grants nothing", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, { state: { signer: "" } });
    const r: any = await kit.handleAction(client, pickRadio(ts, "U3ABC", "U3ABC"));
    expect(r.decision).toMatchObject({ type: "deny", message: "Nobody can do this yet." });
    expect((await kit.getCard("C1", ts))!.state.$signer).toBe("");
  });

  it("denies everyone on an untrusted card", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client, { trusted: false, access: { default: { stateUser: "signer" } } });
    for (const user of ["U1", "U2ABC"]) {
      expect((await kit.handleAction(client, press(ts, user)) as any).decision.type).toBe("deny");
    }
    expect((await kit.getCard("C1", ts))!.locked).toBeUndefined();
  });

  it("refuses a form submit even when its values set the key to the submitter", async () => {
    const { kit, client } = setup();
    const { ts } = await post(kit, client);
    await kit.handleAction(client, click(ts, "U2ABC", { type: "button", action_id: "form:note" }));
    const view = client.calls.find((c: any) => c.method === "views.open")!.args.view;
    const submission = {
      type: "view_submission",
      user: { id: "U3ABC" },
      view: {
        ...view,
        state: { values: { [view.blocks[0].block_id]: { [view.blocks[0].element.action_id]: { type: "plain_text_input", value: "U3ABC" } } } },
      },
    };
    const r: any = await kit.handleViewSubmission(client, submission);
    expect(r.decision).toMatchObject({ type: "deny" });
    expect(r.response?.response_action).toBe("errors");
    const card = (await kit.getCard("C1", ts))!;
    expect(card.state.$signer).toBe("U2ABC");
    expect(card.locked).toBeUndefined();
  });

  it("gives handleOptions the same answer as a click", async () => {
    const SEARCH = `$signer = ""
root = Root([a])
a = Actions([ppl])
ppl = SearchSelect("People", $people, "people", true)
$people = []`;
    const loadOptions = async () => [{ value: "U1", label: "Ana" }];
    const { kit, client } = setup({ loadOptions });
    const { ts } = await kit.postCard(client, target, SEARCH, {
      owner: "U1",
      placeholder: false,
      trusted: true,
      access: { inputs: { stateUser: "signer" } },
      state: { signer: "U2ABC" },
    });
    const ask = (user: string) =>
      kit.handleOptions({
        type: "block_suggestion",
        user: { id: user },
        container: { type: "message", message_ts: ts, channel_id: "C1" },
        action_id: "ppl",
        block_id: "b",
        value: "a",
      });
    expect((await ask("U2ABC")).options).toHaveLength(1);
    expect(await ask("U1")).toEqual({ options: [] });
  });
});

describe("a press only carries inputs the presser may change", () => {
  const REQ = `root = Root([q1, acts])
$one = ""
q1 = Radio("First", $one, [Option("a", "A"), Option("b", "B")])
acts = Actions([send])
send = Button("Send", Action([@Set($sent, "yes")]))`;
  const state = { values: { blk: { q1: { type: "radio_buttons", selected_option: { value: "b" } } } } };
  const postReq = (kit: any, client: any) =>
    kit.postCard(client, target, REQ, { owner: "U1", placeholder: false, access: { buttons: "anyone", inputs: "owner" }, required: [["one"]] });
  const send = (ts: string, user: string) =>
    click(ts, user, { type: "button", action_id: "send", text: { type: "plain_text", text: "Send" } }, { state });

  it("drops a non-allowed user's typed value, so the answer is still missing", async () => {
    const { kit, client } = setup();
    const { ts } = await postReq(kit, client);
    await kit.handleAction(client, send(ts, "U2"));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeUndefined();
    expect(card.state.$one).not.toBe("b");
  });

  it("still applies it for a user the inputs rule allows", async () => {
    const { kit, client } = setup();
    const { ts } = await postReq(kit, client);
    await kit.handleAction(client, send(ts, "U1"));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeDefined();
    expect(card.state.$one).toBe("b");
  });
});
