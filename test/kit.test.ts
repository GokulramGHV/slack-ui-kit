import { describe, expect, it } from "vitest";
import { createSlackKit, EventDeliveryError, type SlackKitOptions } from "../src/kit.js";
import { CardRenderError } from "../src/openui/index.js";
import { MemoryCardStore } from "../src/store.js";
import type { CardEvent, CardRecord } from "../src/types.js";
import { fakeClient, once } from "./helpers/fake-client.js";
import { SAMPLE_CARD } from "./helpers/sample.js";

const target = { channel: "C1", threadTs: "1699999999.000001" };
const now = () => new Date("2026-11-22T10:00:00.000Z");

function setup(opts: SlackKitOptions = {}) {
  const events: CardEvent[] = [];
  const kit = createSlackKit({ now, quiet: true, onEvent: (e) => void events.push(e), ...opts });
  const client = fakeClient();
  return { kit, client, events };
}

const click = (ts: string, user: string, action: any) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "trig-1",
  actions: [action],
});
const tick = (ts: string, user: string, values: string[]) =>
  click(ts, user, { type: "checkboxes", action_id: "pick", selected_options: values.map((value) => ({ value })) });
const press = (ts: string, user: string, id = "go", label = "Go") =>
  click(ts, user, { type: "button", action_id: id, text: { type: "plain_text", text: label } });
const methods = (client: ReturnType<typeof fakeClient>) => client.calls.map((c) => c.method);

describe("postCard", () => {
  it("streams a card into a placeholder and saves it with the host's settings", async () => {
    const { kit, client } = setup();
    const { card, ts } = await kit.postCard(client, target, once(SAMPLE_CARD), {
      owner: "U1",
      access: { inputs: "anyone" },
      meta: { bot: "helper" },
    });
    expect(client.calls[0]).toMatchObject({ method: "chat.postMessage", args: { channel: "C1", thread_ts: target.threadTs } });
    expect(client.calls.at(-1)!.method).toBe("chat.update");
    expect(await kit.getCard("C1", ts)).toEqual(card);
    expect(card).toMatchObject({ owner: "U1", access: { inputs: "anyone" }, meta: { bot: "helper" }, trusted: false, threadTs: target.threadTs });
  });

  it("posts a template directly, with no placeholder, and marks it trusted", async () => {
    const { kit, client } = setup();
    const { card } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", trusted: true, placeholder: false });
    expect(methods(client)).toEqual(["chat.postMessage"]);
    expect(client.calls[0]!.args.blocks).toEqual(card.blocks);
    expect(card.trusted).toBe(true);
  });

  it("throws CardRenderError and saves nothing when Slack refuses the card", async () => {
    const { kit, client } = setup();
    client.chat.update = async (args: any) => {
      client.calls.push({ method: "chat.update", args });
      if (args.blocks?.[0]?.type !== "context") throw Object.assign(new Error("invalid_blocks"), { data: { error: "invalid_blocks" } });
      return { ok: true };
    };
    const err = await kit.postCard(client, target, once(SAMPLE_CARD), { owner: "U1" }).catch((e) => e);
    expect(err).toBeInstanceOf(CardRenderError);
    expect(client.calls.at(-1)!.args.text).toBe("Couldn't show this card (invalid_blocks).");
    expect(await kit.getCard("C1", err.ts)).toBeUndefined();
  });
});

describe("handleAction", () => {
  it("leaves messages that aren't cards to the host", async () => {
    const { kit, client } = setup();
    expect(await kit.handleAction(client, press("9.9", "U1"))).toEqual({ handled: false });
    expect(client.calls).toEqual([]);
  });

  it("applies the owner's checkbox tick without telling the bot", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    const r = await kit.handleAction(client, tick(ts, "U1", ["alpha", "beta"]));
    expect(r).toMatchObject({ handled: true, decision: { type: "apply" } });
    expect((await kit.getCard("C1", ts))!.state.$picks).toEqual(["alpha", "beta"]);
    expect(client.calls.at(-1)!.method).toBe("chat.update");
    expect(events).toEqual([]);
  });

  it("refuses someone else's tick, tells them privately, and redraws the card to undo it", async () => {
    const { kit, client } = setup();
    const { ts, card } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    await kit.handleAction(client, tick(ts, "U2", ["beta"]));
    expect(client.calls.slice(1)).toMatchObject([
      { method: "chat.postEphemeral", args: { channel: "C1", user: "U2", text: "Only <@U1> can do this.", thread_ts: target.threadTs } },
      { method: "chat.update", args: { channel: "C1", ts, text: card.text } },
    ]);
    expect((await kit.getCard("C1", ts))!.state.$picks).toEqual(["alpha"]);
  });

  // Slack keeps a tick on the clicker's screen when the update carries the same blocks.
  // A new block_id on the block holding the input makes Slack draw it fresh.
  it("gives the input's block a new block_id on each refusal redraw, and leaves other blocks as they were", async () => {
    const { kit, client } = setup();
    const { ts, card } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    await kit.handleAction(client, tick(ts, "U2", ["beta"]));
    await kit.handleAction(client, tick(ts, "U3", ["beta"]));
    const [first, second] = client.calls.filter((c) => c.method === "chat.update").map((c) => c.args.blocks);
    const holdsInput = (b: any) => JSON.stringify(b).includes('"checkboxes"');
    const i = card.blocks.findIndex(holdsInput);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(first[i].block_id).toEqual(expect.any(String));
    expect(second[i].block_id).not.toBe(first[i].block_id);
    const { block_id: _drop, ...rest } = first[i];
    expect(rest).toEqual(card.blocks[i]);
    card.blocks.forEach((b, j) => { if (j !== i) expect(first[j]).toEqual(b); });
    expect((await kit.getCard("C1", ts))!.blocks).toEqual(card.blocks);
  });

  it("refuses someone else's button without redrawing", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    await kit.handleAction(client, press(ts, "U2"));
    expect(methods(client).slice(1)).toEqual(["chat.postEphemeral"]);
  });

  it("locks on the owner's button press and tells the bot once", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false, meta: { bot: "helper" } });
    await kit.handleAction(client, press(ts, "U1"));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toEqual({ by: "U1", at: "2026-11-22T10:00:00.000Z", label: "Go" });
    expect(card.state.$decision).toBe("go");
    expect(client.calls.at(-1)!.args.blocks).toEqual(card.blocks);
    expect(events).toEqual([
      {
        type: "action",
        card: { channel: "C1", ts, threadTs: target.threadTs },
        user: "U1",
        control: { id: "go", kind: "button", label: "Go" },
        state: card.state,
        stateLabels: { $picks: ["Alpha"] },
        locked: card.locked,
        meta: { bot: "helper" },
      },
    ]);
  });

  it("refuses a second press after the lock and redraws the locked view", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    await kit.handleAction(client, press(ts, "U1"));
    const locked = (await kit.getCard("C1", ts))!;
    client.calls.length = 0;
    await kit.handleAction(client, press(ts, "U1", "stop", "Stop"));
    expect(client.calls).toEqual([
      { method: "chat.postEphemeral", args: { channel: "C1", user: "U1", text: "This was already submitted.", thread_ts: target.threadTs } },
      { method: "chat.update", args: { channel: "C1", ts, text: locked.text, blocks: locked.blocks } },
    ]);
    expect(events).toHaveLength(1);
  });

  it("ignores a control it doesn't know, even from the owner", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    const r = await kit.handleAction(client, press(ts, "U1", "el_99"));
    expect(r).toMatchObject({ handled: true, decision: { type: "ignore", reason: "unknown-control" } });
    expect(methods(client)).toEqual(["chat.postMessage"]);
    expect(events).toEqual([]);
  });

  it("still tells the bot when writing the card to Slack fails", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    client.chat.update = async () => {
      throw new Error("message_not_found");
    };
    const r = await kit.handleAction(client, press(ts, "U1"));
    expect(events).toHaveLength(1);
    expect(r).toMatchObject({ handled: true, updateError: expect.any(Error) });
  });

  it("attaches the event when onEvent throws, since the click is already saved", async () => {
    const { kit, client } = setup({
      onEvent: () => {
        throw new Error("bot offline");
      },
    });
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    const err = await kit.handleAction(client, press(ts, "U1")).catch((e) => e);
    expect(err).toBeInstanceOf(EventDeliveryError);
    expect(err.event).toMatchObject({ control: { id: "go" }, locked: { by: "U1" } });
    expect((await kit.getCard("C1", ts))!.locked).toBeDefined();
  });

  it("uses Slack user groups through the client, and denies when the lookup fails", async () => {
    const { kit, client } = setup();
    const withGroups: any = {
      ...client,
      usergroups: { users: { list: async ({ usergroup }: any) => ({ users: usergroup === "S1" ? ["U2"] : [] }) } },
    };
    const { ts } = await kit.postCard(withGroups, target, SAMPLE_CARD, { owner: "U1", placeholder: false, access: { buttons: { group: "S1" } } });
    const r = await kit.handleAction(withGroups, press(ts, "U2"));
    expect(r).toMatchObject({ decision: { type: "apply" } });

    const other = setup();
    const failing: any = { ...other.client, usergroups: { users: { list: async () => { throw new Error("missing_scope"); } } } };
    const posted = await other.kit.postCard(failing, target, SAMPLE_CARD, { owner: "U1", placeholder: false, access: { buttons: { group: "S1" } } });
    expect(await other.kit.handleAction(failing, press(posted.ts, "U2"))).toMatchObject({ decision: { type: "deny" } });
  });

  it("retries a tick that lost the version check to another save", async () => {
    const store = new MemoryCardStore();
    let failNext = false;
    const put = store.put.bind(store);
    store.put = async (card: CardRecord, expected: number | null) => {
      if (failNext && expected !== null) {
        failNext = false;
        return false;
      }
      return put(card, expected);
    };
    const { kit, client } = setup({ store });
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    failNext = true;
    await kit.handleAction(client, tick(ts, "U1", ["beta"]));
    expect((await kit.getCard("C1", ts))!.state.$picks).toEqual(["beta"]);
  });
});

describe("handleAction with a Mutation tool", () => {
  const TOOL_CARD = `root = Root([acts])
$d = ""
save = Mutation("save_item", {name: $d})
acts = Actions([go])
go = Button("Go", Action([@Set($d, "go"), @Run(save)]))`;

  it("runs the tool once for two presses at the same moment, after the lock is saved", async () => {
    const order: string[] = [];
    const store = new MemoryCardStore();
    const get = store.get.bind(store);
    const put = store.put.bind(store);
    // A store with real async gaps, like a database.
    store.get = async (c, t) => {
      await new Promise((r) => setTimeout(r, 1));
      return get(c, t);
    };
    store.put = async (card, expected) => {
      await new Promise((r) => setTimeout(r, 1));
      const ok = await put(card, expected);
      if (ok && card.locked && expected !== null) order.push(`put v${card.version}`);
      return ok;
    };
    const { kit, client, events } = setup({
      store,
      tools: {
        specs: [{ name: "save_item", description: "Save.", inputSchema: { type: "object" } }],
        provider: { callTool: async () => (order.push("tool"), { ok: true }) },
      },
    });
    const { ts } = await kit.postCard(client, target, TOOL_CARD, { owner: "U1", placeholder: false });
    await Promise.all([kit.handleAction(client, press(ts, "U1")), kit.handleAction(client, press(ts, "U1"))]);
    expect(order.filter((o) => o === "tool")).toHaveLength(1);
    expect(order.indexOf("put v2")).toBeLessThan(order.indexOf("tool"));
    expect(events).toHaveLength(1);
    expect(client.calls.some((c) => c.method === "chat.postEphemeral" && c.args.text === "This was already submitted.")).toBe(true);
  });

  it("keeps the card locked with a note, and tells the bot, when the work after the lock crashes", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    kit.engine.applyInteraction = async () => {
      throw new Error("engine crashed");
    };
    await kit.handleAction(client, press(ts, "U1"));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.locked).toBeDefined();
    expect(JSON.stringify(card.blocks)).toContain("Something went wrong after this was pressed.");
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBe("engine crashed");
  });
});

describe("forms", () => {
  it("opens a form before any save or tool call, with the host's callback id and hidden data", async () => {
    const order: string[] = [];
    const store = new MemoryCardStore();
    const put = store.put.bind(store);
    store.put = async (c, e) => (order.push("put"), put(c, e));
    const { kit, client } = setup({
      store,
      form: { callbackId: "kit_form", wrapMeta: (m) => JSON.stringify({ m }), unwrapMeta: (s) => JSON.parse(s).m },
    });
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    order.length = 0;
    const open = client.views.open;
    client.views.open = async (args: any) => (order.push("views.open"), open(args));
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "form:note" }));
    expect(order).toEqual(["views.open"]);
    const view = client.calls.find((c) => c.method === "views.open")!.args.view;
    expect(view.callback_id).toBe("kit_form");
    expect(JSON.parse(view.private_metadata)).toEqual({ m: { channel: "C1", ts, formId: "note" } });
  });

  async function openForm(kit: any, client: any, ts: string) {
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "form:note" }));
    return client.calls.find((c: any) => c.method === "views.open")!.args.view;
  }
  const submission = (view: any, user: string, value: string) => ({
    type: "view_submission",
    user: { id: user },
    view: {
      ...view,
      state: { values: { [view.blocks[0].block_id]: { [view.blocks[0].element.action_id]: { type: "plain_text_input", value } } } },
    },
  });

  it("closes the form at once, then applies the submit, locks and tells the bot", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    const view = await openForm(kit, client, ts);
    const r = await kit.handleViewSubmission(client, submission(view, "U1", "looks good"));
    expect(r).toMatchObject({ handled: true, response: undefined });
    await (r as any).done;
    const card = (await kit.getCard("C1", ts))!;
    expect(card.state.$comment).toBe("looks good");
    expect(card.locked).toMatchObject({ by: "U1", label: "" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "submit", control: { id: "form:note", kind: "form", value: { $comment: "looks good" } } });
  });

  it("shows an error inside the form when the card locked while it was open", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, SAMPLE_CARD, { owner: "U1", placeholder: false });
    const view = await openForm(kit, client, ts);
    await kit.handleAction(client, press(ts, "U1"));
    const r: any = await kit.handleViewSubmission(client, submission(view, "U1", "late"));
    expect(r.response).toEqual({ response_action: "errors", errors: { [view.blocks[0].block_id]: "This was already submitted." } });
    expect((await kit.getCard("C1", ts))!.state.$comment).toBe("");
  });

  it("leaves forms that aren't ours to the host", async () => {
    const { kit, client } = setup();
    expect(await kit.handleViewSubmission(client, { type: "view_submission", user: { id: "U1" }, view: { callback_id: "other" } })).toEqual({
      handled: false,
    });
  });
});

describe("registerCard and feedback", () => {
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: "Release ready." } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Ack" }, action_id: "ack" }] },
    { type: "context_actions", elements: [{ type: "feedback_buttons", action_id: "fb" }] },
  ];

  it("gives raw cards the same rules, lock and event, with per-id rules since they are trusted", async () => {
    const { kit, client, events } = setup();
    await kit.registerCard({ channel: "C1", ts: "5.5", blocks, owner: "U1", access: { byId: { ack: { users: ["U2"] } } } });
    await kit.handleAction(client, press("5.5", "U3", "ack", "Ack"));
    expect(events).toEqual([]);
    await kit.handleAction(client, press("5.5", "U2", "ack", "Ack"));
    const card = (await kit.getCard("C1", "5.5"))!;
    expect(card.locked).toMatchObject({ by: "U2", label: "Ack" });
    expect(events).toHaveLength(1);
  });

  it("takes feedback from anyone, even on a locked card, without saving or locking", async () => {
    const { kit, client, events } = setup();
    await kit.registerCard({ channel: "C1", ts: "5.5", blocks, owner: "U1" });
    await kit.handleAction(client, press("5.5", "U1", "ack", "Ack"));
    const before = (await kit.getCard("C1", "5.5"))!;
    client.calls.length = 0;
    await kit.handleAction(client, click("5.5", "U7", { type: "feedback_buttons", action_id: "fb", value: "positive" }));
    expect(client.calls).toEqual([]);
    expect(await kit.getCard("C1", "5.5")).toEqual(before);
    expect(events.at(-1)).toMatchObject({ user: "U7", control: { kind: "feedback", value: "positive" } });
  });
});

describe("components", () => {
  it("adds the kit's components by default, next to the host's own", async () => {
    const { defineBlockComponent } = await import("@openuidev/channels");
    const { z } = await import("zod");
    const Banner = defineBlockComponent({
      name: "Banner",
      description: "A host banner.",
      props: z.object({ text: z.string() }),
      render: ({ props }) => [{ type: "section", text: { type: "mrkdwn", text: `*${props.text}*` } }],
    });
    const kit = createSlackKit({ components: { add: [{ component: Banner, slots: ["Root"] }] } });
    expect(kit.prompt).toContain("Plan(");
    expect(kit.prompt).toContain("Banner(");
  });

  it("lets a host component replace a kit component of the same name", async () => {
    const { defineBlockComponent } = await import("@openuidev/channels");
    const { z } = await import("zod");
    const Plan = defineBlockComponent({
      name: "Plan",
      description: "The host's own plan.",
      props: z.object({ steps: z.array(z.string()) }),
      render: ({ props }) => [{ type: "section", text: { type: "mrkdwn", text: props.steps.join(" > ") } }],
    });
    const kit = createSlackKit({ components: { add: [{ component: Plan, slots: ["Root"] }] } });
    const r = await kit.render('root = Root([p])\np = Plan(["a", "b"])');
    expect(r.blocks).toEqual([{ type: "section", text: { type: "mrkdwn", text: "a > b" } }]);
  });
});

describe("components remove", () => {
  it("drops a kit component the host removes", () => {
    const kit = createSlackKit({ components: { remove: ["Plan"] } });
    expect(kit.prompt).not.toContain("Plan(");
    expect(kit.prompt).toContain("TaskCard(");
  });
});

describe("forms with an Alert", () => {
  const SRC = `root = Root([f])
$note = ""
f = Form("Release", "Start", [Alert("This releases to everyone.", "warning"), TextInput("Note", $note), Alert("Takes about a minute.")])`;

  it("shows the alerts in the modal in their places, and keys errors on the first input", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, SRC, { owner: "U1", placeholder: false });
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "form:f" }));
    const view = client.calls.find((c) => c.method === "views.open")!.args.view;
    expect(view.blocks.map((b: any) => b.type)).toEqual(["alert", "input", "alert"]);
    expect(view.blocks[0]).toEqual({ type: "alert", level: "warning", text: { type: "mrkdwn", text: "This releases to everyone." } });

    const r: any = await kit.handleViewSubmission(client, {
      type: "view_submission",
      user: { id: "U2" },
      view: { ...view, state: { values: { $note: { $note: { type: "plain_text_input", value: "x" } } } } },
    });
    expect(r.response).toEqual({ response_action: "errors", errors: { $note: "Only <@U1> can do this." } });
  });
});

describe("a modal Slack refuses because of an alert", () => {
  it("opens the form again without the alerts", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(
      client,
      target,
      `root = Root([f])
$note = ""
f = Form("Release", "Start", [Alert("Careful.", "warning"), TextInput("Note", $note)])`,
      { owner: "U1", placeholder: false },
    );
    const views: any[] = [];
    client.views.open = async (args: any) => {
      views.push(args.view);
      if (args.view.blocks.some((b: any) => b.type === "alert")) throw Object.assign(new Error("invalid_arguments"), { data: { error: "invalid_arguments" } });
      return { ok: true };
    };
    await kit.handleAction(client, click(ts, "U1", { type: "button", action_id: "form:f" }));
    expect(views.map((v) => v.blocks.map((b: any) => b.type))).toEqual([["alert", "input"], ["input"]]);
  });
});

describe("removing kit components that others refer to", () => {
  it("drops their signatures and still renders Plan and Tags without crashing", async () => {
    const kit = createSlackKit({ quiet: true, components: { remove: ["TaskCard", "Tag"] } });
    expect(kit.prompt).not.toMatch(/^TaskCard\(/m);
    expect(kit.prompt).not.toMatch(/^Tag\(/m);
    await expect(kit.render('root = Root([p])\np = Plan("x", [TaskCard("a", "complete")])')).resolves.toBeDefined();
    await expect(kit.render('root = Root([t])\nt = Tags([Tag("a", "green")])')).resolves.toBeDefined();
  });
});
