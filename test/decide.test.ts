import { describe, expect, it } from "vitest";
import { clickFromAction, clickFromSubmission, decide } from "../src/decide.js";
import type { Access, CardRecord } from "../src/types.js";

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  channel: "C1",
  ts: "1.1",
  owner: "U1",
  access: {},
  trusted: false,
  kind: "openui",
  source: "",
  state: {},
  text: "card",
  blocks: [],
  controls: { go: "button", pick: "input", fb: "feedback", "form:note": "form" },
  forms: {},
  version: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  ...over,
});
const groups = async (id: string) => (id === "S1" ? ["U2"] : []);
const ctx = { resolveGroup: groups };

describe("decide", () => {
  it("lets the owner press a button, which locks the card and tells the bot", async () => {
    const d = await decide({ user: "U1", actionId: "go", label: "Go" }, card(), ctx);
    expect(d).toMatchObject({ type: "apply", kind: "button", lock: true, notify: true });
  });

  it("refuses anyone else by default, with a note naming the owner", async () => {
    const d = await decide({ user: "U2", actionId: "go" }, card(), ctx);
    expect(d).toMatchObject({ type: "deny", kind: "button", message: "Only <@U1> can do this." });
  });

  it("applies a group rule", async () => {
    const access: Access = { buttons: { group: "S1" } };
    expect((await decide({ user: "U2", actionId: "go" }, card({ access }), ctx)).type).toBe("apply");
    expect((await decide({ user: "U3", actionId: "go" }, card({ access }), ctx)).type).toBe("deny");
  });

  it("changes inputs without locking and without telling the bot", async () => {
    const d = await decide({ user: "U1", actionId: "pick", value: ["a"] }, card(), ctx);
    expect(d).toMatchObject({ type: "apply", kind: "input", lock: false, notify: false });
  });

  it("tells the bot about inputs too when events is 'all'", async () => {
    const d = await decide({ user: "U1", actionId: "pick" }, card(), { ...ctx, events: "all" });
    expect(d).toMatchObject({ notify: true });
  });

  it("does not lock when the card's lock is 'never'", async () => {
    const d = await decide({ user: "U1", actionId: "go" }, card({ access: { lock: "never" } }), ctx);
    expect(d).toMatchObject({ type: "apply", lock: false, notify: true });
  });

  it("locks only on listed ids for a trusted card, and ignores the list on an untrusted one", async () => {
    const access: Access = { lock: { ids: ["other"] } };
    expect(await decide({ user: "U1", actionId: "go" }, card({ access, trusted: true }), ctx)).toMatchObject({ lock: false });
    expect(await decide({ user: "U1", actionId: "go" }, card({ access, trusted: false }), ctx)).toMatchObject({ lock: true });
  });

  it("refuses every click except feedback once the card is locked", async () => {
    const locked = card({ locked: { by: "U1", at: "2026-11-22T00:00:00.000Z", label: "Go" } });
    expect((await decide({ user: "U1", actionId: "go" }, locked, ctx)).type).toBe("locked");
    expect((await decide({ user: "U1", actionId: "pick" }, locked, ctx)).type).toBe("locked");
    expect(await decide({ user: "U9", actionId: "fb", value: "positive" }, locked, ctx)).toMatchObject({
      type: "apply",
      kind: "feedback",
      lock: false,
      notify: true,
    });
  });

  it("ignores link buttons and controls it doesn't know, even for the owner", async () => {
    expect(await decide({ user: "U1", actionId: "docs", url: true }, card(), ctx)).toMatchObject({ type: "ignore", reason: "link" });
    expect(await decide({ user: "U1", actionId: "el_9" }, card(), ctx)).toMatchObject({ type: "ignore", reason: "unknown-control" });
  });

  it("opens a form for the owner and refuses others", async () => {
    expect(await decide({ user: "U1", actionId: "form:note" }, card(), ctx)).toMatchObject({ type: "open-form", formId: "note" });
    expect((await decide({ user: "U2", actionId: "form:note" }, card(), ctx)).type).toBe("deny");
  });

  it("checks a form submit again: it locks and tells the bot", async () => {
    const submit = { user: "U1", actionId: "form:note", submit: { formId: "note", values: { $x: 1 } } };
    expect(await decide(submit, card(), ctx)).toMatchObject({ type: "apply", kind: "form", lock: true, notify: true });
    const locked = card({ locked: { by: "U1", at: "2026-11-22T00:00:00.000Z", label: "Go" } });
    expect((await decide(submit, locked, ctx)).type).toBe("locked");
  });
});

describe("clickFromAction", () => {
  it("reads channel, message, user and the first action", () => {
    const r = clickFromAction({
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.1" },
      trigger_id: "t",
      actions: [{ type: "checkboxes", action_id: "pick", selected_options: [{ value: "a" }] }],
    });
    expect(r).toEqual({
      channel: "C1",
      ts: "1.1",
      triggerId: "t",
      click: { user: "U1", actionId: "pick", label: undefined, value: ["a"], url: false, elementType: "checkboxes" },
    });
  });

  it("reads a feedback button's value and a button's label", () => {
    const base = { user: { id: "U1" }, container: { channel_id: "C1", message_ts: "1.1" } };
    expect(clickFromAction({ ...base, actions: [{ type: "feedback_buttons", action_id: "fb", value: "positive" }] })!.click.value).toBe("positive");
    expect(clickFromAction({ ...base, actions: [{ type: "button", action_id: "go", text: { text: "Go" }, value: "v" }] })!.click).toMatchObject({ label: "Go", value: "v" });
  });

  it("returns undefined when the payload has no message or action", () => {
    expect(clickFromAction({ user: { id: "U1" }, actions: [] })).toBeUndefined();
  });
});

describe("clickFromSubmission", () => {
  const view = (meta: string, callback_id = "openui_form") => ({
    type: "view_submission",
    user: { id: "U1" },
    view: { callback_id, private_metadata: meta, state: { values: {} }, blocks: [] },
  });
  const opts = { callbackId: "openui_form", unwrapMeta: (s: string) => JSON.parse(s) };

  it("reads the card and form from the form's hidden data, and the submitted values", () => {
    const p = view(JSON.stringify({ channel: "C1", ts: "1.1", formId: "note" })) as any;
    p.view.blocks = [{ type: "input", block_id: "b1", element: { type: "plain_text_input", action_id: "$comment" } }];
    p.view.state.values = { b1: { $comment: { type: "plain_text_input", value: "hi" } } };
    const r = clickFromSubmission(p, opts);
    expect(r!.click.submit!.values).toEqual({ $comment: "hi" });
    expect(r).toMatchObject({ channel: "C1", ts: "1.1", click: { user: "U1", actionId: "form:note", submit: { formId: "note" } } });
  });

  it("is not ours when the callback id differs or the hidden data is unreadable", () => {
    expect(clickFromSubmission(view("{}", "other"), opts)).toBeUndefined();
    expect(clickFromSubmission(view("not json"), opts)).toBeUndefined();
    expect(clickFromSubmission(view(JSON.stringify({ channel: "C1" })), opts)).toBeUndefined();
  });

  describe("stateUser rule", () => {
    const access: Access = { buttons: { stateUser: "assignee" }, inputs: { stateUser: "assignee" } };

    it("applies for the named user and denies everyone else, owner included", async () => {
      const c = card({ access, state: { $assignee: "U2ABC" } });
      expect((await decide({ user: "U2ABC", actionId: "go" }, c, ctx)).type).toBe("apply");
      expect(await decide({ user: "U1", actionId: "go" }, c, ctx)).toMatchObject({ type: "deny", message: "Only <@U2ABC> can do this." });
      expect((await decide({ user: "U3", actionId: "pick" }, c, ctx)).type).toBe("deny");
    });

    it("denies everyone when the state has no valid user id", async () => {
      const c = card({ access, state: { $assignee: "" } });
      expect(await decide({ user: "U1", actionId: "go" }, c, ctx)).toMatchObject({ type: "deny", message: "Nobody can do this yet." });
      expect((await decide({ user: "U2ABC", actionId: "go" }, card({ access }), ctx)).type).toBe("deny");
    });

    it("is decided on the state before the click, so a click can't grant itself access", async () => {
      // The record holds the pre-click state; the click's own value (naming the clicker) is not in it.
      const c = card({ access, state: { $assignee: "U2ABC" } });
      const d = await decide({ user: "U3", actionId: "pick", value: "U3" }, c, ctx);
      expect(d.type).toBe("deny");
      const empty = card({ access, state: {} });
      expect((await decide({ user: "U3", actionId: "pick", value: "U3" }, empty, ctx)).type).toBe("deny");
    });
  });
});
