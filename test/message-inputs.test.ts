import { describe, expect, it, vi } from "vitest";
import { CardRenderError, createSlackKit, type CardEvent } from "../src/index.js";
import { buildPrompt } from "../src/openui/index.js";
import { fakeClient } from "./helpers/fake-client.js";

const target = { channel: "C1" };
const opt = (value: string, text: string) => ({ value, text: { type: "plain_text", text } });
const act = (ts: string, user: string, action: Record<string, unknown>) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "t",
  actions: [action],
});

function setup(o: Parameters<typeof createSlackKit>[0] = {}) {
  const events: CardEvent[] = [];
  const kit = createSlackKit({ quiet: true, onEvent: (e) => void events.push(e), ...o });
  return { kit, events, client: fakeClient() };
}

const NUM = `$points = 3
$done = ""
root = Root([a])
a = Actions([n, go])
n = NumberInput("Points", $points)
go = Button("Go", Action([@Set($done, "yes")]))`;

describe("NumberInput in Actions", () => {
  it("renders its own input block with dispatch_action, after the button row", async () => {
    const { kit } = setup();
    const r = await kit.render(NUM);
    expect(r.blocks).toEqual([
      { type: "actions", elements: [expect.objectContaining({ type: "button", action_id: "go" })] },
      {
        type: "input",
        dispatch_action: true,
        label: { type: "plain_text", text: "Points" },
        element: { type: "number_input", action_id: "n", is_decimal_allowed: false, initial_value: "3" },
      },
    ]);
    expect(r.controls).toMatchObject({ n: "input", go: "button" });
  });

  it("has no initial value while the variable is empty", async () => {
    const { kit } = setup();
    const r = await kit.render(`$points = null\nroot = Root([Actions([NumberInput("Points", $points)])])`);
    expect((r.blocks[0] as any).element).toEqual({ type: "number_input", action_id: "el_0", is_decimal_allowed: false });
  });

  it("still works inside a Form", async () => {
    const { kit } = setup();
    const r = await kit.render(`$n = 2\nroot = Root([Form("Points", "Save", [NumberInput("Points", $n)])])`);
    expect(Object.values(r.forms)[0]!.fields[0]).toMatchObject({ kind: "number", initial: 2 });
  });

  it("is taught to the model", () => {
    expect(buildPrompt(setup().kit.library)).toContain("Actions");
    expect(buildPrompt(setup().kit.library)).toContain("NumberInput(label, $var)");
  });

  it("saves a change into state, with no event by default, and redraws with the new value", async () => {
    const { kit, events, client } = setup();
    const { ts } = await kit.postCard(client, target, NUM, { owner: "U1", placeholder: false });
    client.calls.length = 0;
    const res: any = await kit.handleAction(client, act(ts, "U1", { type: "number_input", action_id: "n", value: "7" }));
    expect(res.card.state.$points).toBe(7);
    expect(res.card.locked).toBeUndefined();
    expect(events).toEqual([]);
    const update = client.calls.find((c) => c.method === "chat.update")!.args;
    expect(update.blocks[1].element.initial_value).toBe("7");
  });

  it("fires an event when events is all, and a cleared field saves null", async () => {
    const { kit, events, client } = setup({ events: "all" });
    const { ts } = await kit.postCard(client, target, NUM, { owner: "U1", placeholder: false });
    const res: any = await kit.handleAction(client, act(ts, "U1", { type: "number_input", action_id: "n", value: "" }));
    expect(res.card.state.$points).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.control).toMatchObject({ id: "n", kind: "input" });
  });

  it("counts for required, and shows in the lock summary", async () => {
    const { kit, events, client } = setup();
    const src = NUM.replace("$points = 3", "$points = null");
    const { ts } = await kit.postCard(client, target, src, { owner: "U1", placeholder: false, required: [["points"]] });
    const refused: any = await kit.handleAction(client, act(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }));
    expect(refused.card.locked).toBeUndefined();
    expect(events).toEqual([]);
    expect(client.calls.some((c) => c.method === "chat.postEphemeral")).toBe(true);

    await kit.handleAction(client, act(ts, "U1", { type: "number_input", action_id: "n", value: "5" }));
    const ok: any = await kit.handleAction(client, act(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }));
    expect(ok.card.locked).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.state.$points).toBe(5);
    const summary = ok.card.blocks.find((b: any) => b.type === "section");
    expect(summary.text.text).toBe("*Points:* 5");
  });

  it("counts a number sent in the same payload as the press", async () => {
    const { kit, client } = setup();
    const src = NUM.replace("$points = 3", "$points = null");
    const { ts } = await kit.postCard(client, target, src, { owner: "U1", placeholder: false, required: [["points"]] });
    const payload = {
      ...act(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }),
      state: { values: { b1: { n: { type: "number_input", value: "9" } } } },
    };
    const ok: any = await kit.handleAction(client, payload);
    expect(ok.card.locked).toBeDefined();
    expect(ok.card.state.$points).toBe(9);
  });

  it("redraws the card when someone else's change is refused", async () => {
    const { kit, client, events } = setup();
    const { ts } = await kit.postCard(client, target, NUM, { owner: "U1", placeholder: false });
    client.calls.length = 0;
    const res: any = await kit.handleAction(client, act(ts, "U2", { type: "number_input", action_id: "n", value: "99" }));
    expect(res.decision.type).toBe("deny");
    expect(res.card.state.$points).toBe(3);
    expect(events).toEqual([]);
    expect(client.calls.some((c) => c.method === "chat.postEphemeral")).toBe(true);
    const update = client.calls.find((c) => c.method === "chat.update")!.args;
    expect(update.blocks[1].block_id).toMatch(/^r/);
    expect(update.blocks[1].element.initial_value).toBe("3");
  });
});

const SEARCH = `$people = [{value: "U1", label: "Ana"}]
$owner = null
root = Root([a])
a = Actions([ppl, own, go])
ppl = SearchSelect("People", $people, "people", true)
own = SearchSelect("Owner", $owner, "directory")
go = Button("Go", Action([@Set($people, $people)]))`;

const suggestion = (ts: string, user: string, actionId: string, value: string) => ({
  type: "block_suggestion",
  user: { id: user },
  container: { type: "message", message_ts: ts, channel_id: "C1" },
  action_id: actionId,
  block_id: "b",
  value,
});

describe("SearchSelect", () => {
  it("renders input blocks with external selects, min_query_length and the picks as initial options", async () => {
    const { kit } = setup();
    const r = await kit.render(SEARCH);
    expect(r.blocks[1]).toEqual({
      type: "input",
      dispatch_action: true,
      label: { type: "plain_text", text: "People" },
      element: {
        type: "multi_external_select",
        action_id: "ppl",
        placeholder: { type: "plain_text", text: "People" },
        min_query_length: 1,
        initial_options: [{ text: { type: "plain_text", text: "Ana" }, value: "U1" }],
      },
    });
    expect(r.blocks[2]).toEqual({
      type: "input",
      dispatch_action: true,
      label: { type: "plain_text", text: "Owner" },
      element: { type: "external_select", action_id: "own", placeholder: { type: "plain_text", text: "Owner" }, min_query_length: 1 },
    });
    expect(r.controls).toMatchObject({ ppl: "input", own: "input" });
  });

  it("prefills a single pick from an item or a plain value, and clips the label to 75", async () => {
    const { kit } = setup();
    const a = await kit.render(SEARCH, { owner: { value: "U9", label: "x".repeat(100) } });
    const initial = (a.blocks[2] as any).element.initial_option;
    expect(initial.value).toBe("U9");
    expect(initial.text.text).toHaveLength(75);
    const b = await kit.render(SEARCH, { owner: "U7" });
    expect((b.blocks[2] as any).element.initial_option).toEqual({ text: { type: "plain_text", text: "U7" }, value: "U7" });
  });

  it("is taught to the model", () => {
    expect(buildPrompt(setup().kit.library)).toContain("SearchSelect(name, $chosen, source, multi?)");
  });

  it("saves picks into state as items, with labels in the event and in stateLabels", async () => {
    const { kit, events, client } = setup({ events: "all" });
    const { ts } = await kit.postCard(client, target, SEARCH, { owner: "U1", placeholder: false });
    const picked: any = await kit.handleAction(
      client,
      act(ts, "U1", { type: "multi_external_select", action_id: "ppl", selected_options: [opt("U1", "Ana"), opt("U2", "Bo")] }),
    );
    expect(picked.card.state.$people).toEqual([
      { value: "U1", label: "Ana" },
      { value: "U2", label: "Bo" },
    ]);
    expect(picked.card.locked).toBeUndefined();
    expect(events.at(-1)!.stateLabels).toEqual({ $people: ["Ana", "Bo"] });
    expect(events.at(-1)!.control.labels).toEqual({ ppl: ["Ana", "Bo"] });
    const update = client.calls.filter((c) => c.method === "chat.update").at(-1)!.args;
    expect(update.blocks[1].element.initial_options.map((o: any) => o.value)).toEqual(["U1", "U2"]);

    await kit.handleAction(client, act(ts, "U1", { type: "external_select", action_id: "own", selected_option: opt("U2", "Bo") }));
    const card = (await kit.getCard("C1", ts))!;
    expect(card.state.$owner).toEqual({ value: "U2", label: "Bo" });
    expect(events.at(-1)!.stateLabels).toEqual({ $people: ["Ana", "Bo"], $owner: "Bo" });
  });

  it("counts for required and shows in the lock summary", async () => {
    const { kit, client } = setup();
    const src = SEARCH.replace('$people = [{value: "U1", label: "Ana"}]', "$people = []");
    const { ts } = await kit.postCard(client, target, src, { owner: "U1", placeholder: false, required: [["people"]] });
    const go = act(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } });
    expect(((await kit.handleAction(client, go)) as any).card.locked).toBeUndefined();
    await kit.handleAction(client, act(ts, "U1", { type: "multi_external_select", action_id: "ppl", selected_options: [opt("U1", "Ana & Co")] }));
    const done: any = await kit.handleAction(client, go);
    expect(done.card.locked).toBeDefined();
    const lines = done.card.blocks.filter((b: any) => b.type === "section").map((b: any) => b.text.text);
    expect(lines).toContain("*People:* Ana &amp; Co");
  });
});

describe("handleOptions", () => {
  const post = async (kit: ReturnType<typeof setup>["kit"], client: ReturnType<typeof fakeClient>, src = SEARCH) =>
    (await kit.postCard(client, target, src, { owner: "U1", placeholder: false })).ts;

  it("calls loadOptions with the source word, the query, the card and the user, and returns Slack's shape", async () => {
    const loadOptions = vi.fn(async () => [{ value: "U1", label: "Ana" }, { value: "U2", label: "Bo" }]);
    const { kit, client } = setup({ loadOptions });
    const ts = await post(kit, client);
    const out = await kit.handleOptions(suggestion(ts, "U1", "ppl", "an"));
    expect(out).toEqual({
      options: [
        { text: { type: "plain_text", text: "Ana" }, value: "U1" },
        { text: { type: "plain_text", text: "Bo" }, value: "U2" },
      ],
    });
    expect(loadOptions).toHaveBeenCalledOnce();
    const args = (loadOptions.mock.calls[0] as any)[0];
    expect(args).toMatchObject({ source: "people", query: "an", user: "U1" });
    expect(args.card.ts).toBe(ts);
    await kit.handleOptions(suggestion(ts, "U1", "own", "x"));
    expect((loadOptions.mock.calls[1] as any)[0].source).toBe("directory");
  });

  it("returns at most 100 options and clips labels to 75", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ value: `v${i}`, label: "L".repeat(120) }));
    const { kit, client } = setup({ loadOptions: async () => many });
    const ts = await post(kit, client);
    const out = await kit.handleOptions(suggestion(ts, "U1", "ppl", "l"));
    expect(out.options).toHaveLength(100);
    expect(out.options[0]!.text.text).toHaveLength(75);
    expect(out.options[0]!.text.text.endsWith("…")).toBe(true);
  });

  it("gives a refused user no options and does not call loadOptions", async () => {
    const loadOptions = vi.fn(async () => [{ value: "U1", label: "Ana" }]);
    const { kit, client } = setup({ loadOptions });
    const ts = await post(kit, client);
    expect(await kit.handleOptions(suggestion(ts, "U2", "ppl", "a"))).toEqual({ options: [] });
    expect(loadOptions).not.toHaveBeenCalled();
  });

  it("gives an allowed other user options when the card lets anyone use inputs", async () => {
    const { kit, client } = setup({ loadOptions: async () => [{ value: "U1", label: "Ana" }] });
    const { ts } = await kit.postCard(client, target, SEARCH, { owner: "U1", placeholder: false, access: { inputs: "anyone" } });
    expect((await kit.handleOptions(suggestion(ts, "U2", "ppl", "a"))).options).toHaveLength(1);
  });

  it("skips options whose value is over 150 characters", async () => {
    const { kit, client } = setup({
      loadOptions: async () => [
        { value: "v".repeat(151), label: "too long" },
        { value: "v".repeat(150), label: "ok" },
      ],
    });
    const ts = await post(kit, client);
    const out = await kit.handleOptions(suggestion(ts, "U1", "ppl", "a"));
    expect(out.options.map((o) => o.text.text)).toEqual(["ok"]);
  });

  it("gives no options when loadOptions is missing or throws, without throwing", async () => {
    const a = setup();
    const tsA = await post(a.kit, a.client);
    expect(await a.kit.handleOptions(suggestion(tsA, "U1", "ppl", "a"))).toEqual({ options: [] });
    const b = setup({
      loadOptions: async () => {
        throw new Error("search down");
      },
    });
    const tsB = await post(b.kit, b.client);
    expect(await b.kit.handleOptions(suggestion(tsB, "U1", "ppl", "a"))).toEqual({ options: [] });
  });

  it("gives no options for an unknown card, an unknown control, a button, a locked card or a junk payload", async () => {
    const loadOptions = vi.fn(async () => [{ value: "U1", label: "Ana" }]);
    const { kit, client } = setup({ loadOptions });
    const ts = await post(kit, client);
    expect(await kit.handleOptions(suggestion("9.9", "U1", "ppl", "a"))).toEqual({ options: [] });
    expect(await kit.handleOptions(suggestion(ts, "U1", "nope", "a"))).toEqual({ options: [] });
    expect(await kit.handleOptions(suggestion(ts, "U1", "go", "a"))).toEqual({ options: [] });
    expect(await kit.handleOptions(null)).toEqual({ options: [] });
    expect(await kit.handleOptions({})).toEqual({ options: [] });
    await kit.handleAction(client, act(ts, "U1", { type: "button", action_id: "go", text: { type: "plain_text", text: "Go" } }));
    expect(await kit.handleOptions(suggestion(ts, "U1", "ppl", "a"))).toEqual({ options: [] });
    expect(loadOptions).not.toHaveBeenCalled();
  });

  it("checks a user group rule with the client it is given", async () => {
    const loadOptions = vi.fn(async () => [{ value: "U1", label: "Ana" }]);
    const { kit, client } = setup({ loadOptions, groups: async () => ["U2"] });
    const { ts } = await kit.postCard(client, target, SEARCH, { owner: "U1", placeholder: false, access: { inputs: { group: "S1" } } });
    expect((await kit.handleOptions(suggestion(ts, "U2", "ppl", "a"))).options).toHaveLength(1);
    expect((await kit.handleOptions(suggestion(ts, "U3", "ppl", "a"))).options).toHaveLength(0);
  });
});

describe("a component where the parent would drop it (SearchSelect in Root)", () => {
  const FORM_IN_ACTIONS = `$o = null\nroot = Root([Section("Pick"), SearchSelect("Owner", $o, "people")])`;

  it("render throws a CardRenderError naming the component and where it is", async () => {
    const { kit } = setup();
    const err: any = await kit.render(FORM_IN_ACTIONS).catch((e) => e);
    expect(err).toBeInstanceOf(CardRenderError);
    expect(err.message).toContain("SearchSelect is not allowed in Root.children");
    expect(err.message).toContain("Root.children[1]");
    expect(err.source).toBe(FORM_IN_ACTIONS);
  });

  it("postCard fails loudly without a placeholder, and posts nothing", async () => {
    const { kit, client } = setup();
    await expect(kit.postCard(client, target, FORM_IN_ACTIONS, { owner: "U1", placeholder: false })).rejects.toBeInstanceOf(CardRenderError);
    expect(client.calls.some((c) => c.method === "chat.postMessage")).toBe(false);
  });

  it("postCard with a placeholder replaces it with the short note and throws the named error", async () => {
    const { kit, client } = setup();
    const err: any = await kit.postCard(client, target, FORM_IN_ACTIONS, { owner: "U1" }).catch((e) => e);
    expect(err).toBeInstanceOf(CardRenderError);
    expect(err.message).toContain("SearchSelect is not allowed in Root.children");
    expect(err.ts).toMatch(/^1700000000/);
    const update = client.calls.find((c) => c.method === "chat.update")!.args;
    expect(update.text).toBe("Couldn't show this card.");
  });

  it("catches NumberInput in a Container, and SearchSelect or NumberInput in a Section accessory", async () => {
    const { kit } = setup();
    const a: any = await kit.render(`$n = 1\nroot = Root([Container("c", [NumberInput("N", $n)])])`).catch((e) => e);
    expect(a).toBeInstanceOf(CardRenderError);
    expect(a.message).toContain("NumberInput is not allowed in Container.children");
    await expect(kit.render(`$n = 1\nroot = Root([Section("x", NumberInput("N", $n))])`)).rejects.toBeInstanceOf(CardRenderError);
  });

  it("also catches a field a Form would drop", async () => {
    const { kit } = setup();
    const err: any = await kit
      .render(`$r = ""\nroot = Root([Form("Pick", "Save", [Radio("r", $r, [Option("a", "A")])])])`)
      .catch((e) => e);
    expect(err.message).toContain("Radio is not allowed in Form.fields");
  });

  it("leaves other OpenUI warnings alone: stray inputs in Root, unknown components, extra args", async () => {
    const { kit } = setup();
    await expect(kit.render(`$r = ""\nroot = Root([Radio("r", $r, [Option("a", "A")])])`)).resolves.toBeDefined();
    await expect(kit.render(`root = Root([Zork("a"), Section("hi")])`)).resolves.toBeDefined();
    await expect(kit.render(`root = Root([Section("hi", null, "extra", "args")])`)).resolves.toBeDefined();
  });
});
