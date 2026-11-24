import { describe, expect, it } from "vitest";
import { blocks, clipTo } from "../src/blocks.js";
import { createSlackKit, type CardEvent } from "../src/index.js";
import { buildPrompt } from "../src/openui/index.js";
import { fakeClient } from "./helpers/fake-client.js";

const target = { channel: "C1" };
const act = (ts: string, user: string, action: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "t",
  actions: [action],
  ...extra,
});
const press = (id: string, text = "Go") => ({ type: "button", action_id: id, text: { type: "plain_text", text } });

function setup(o: Parameters<typeof createSlackKit>[0] = {}) {
  const events: CardEvent[] = [];
  const kit = createSlackKit({ quiet: true, onEvent: (e) => void events.push(e), ...o });
  return { kit, events, client: fakeClient() };
}

const DRAFT = `$title = "Fix login"
$points = null
$done = ""
root = Root([box])
box = Container("Draft", [Section("A draft ticket."), Tags([Tag("bug", "red")]), Context("from a thread"), row], false, false, "full")
row = Actions([edit, Button("Cancel", Action([@Set($done, "cancel")])), create, pts])
edit = Form("Edit details", "Save", [TextInput("Title", $title)])
create = Button("Create", Action([@Set($done, "create")]), "primary")
pts = NumberInput("Points", $points)`;

describe("Form in Actions", () => {
  it("puts the open-form button in the same row, in the order written", async () => {
    const { kit } = setup();
    const r = await kit.render(`$t = ""\nroot = Root([Actions([Form("Edit", "Save", [TextInput("T", $t)]), Button("Cancel"), Button("Create")])])`);
    const row = (r.blocks[0] as any).elements;
    expect(r.blocks).toHaveLength(1);
    expect(row.map((e: any) => e.text.text)).toEqual(["Edit", "Cancel", "Create"]);
    expect(row[0].action_id).toMatch(/^form:/);
    expect(Object.keys(r.forms)).toHaveLength(1);
    expect(r.controls[row[0].action_id]).toBe("form");
  });

  it("opens the modal on click like a top-level Form", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, `$t = "x"\nroot = Root([Actions([Form("Edit", "Save", [TextInput("T", $t)]), Button("Go")])])`, { owner: "U1", placeholder: false });
    const id = (client.calls.find((c) => c.method === "chat.postMessage")!.args.blocks[0].elements[0].action_id) as string;
    await kit.handleAction(client, act(ts, "U1", { type: "button", action_id: id }));
    const view = client.calls.find((c) => c.method === "views.open")!.args.view;
    expect(view.callback_id).toBe("openui_form");
    expect(view.blocks[0].element.initial_value).toBe("x");
  });

  it("is taught to the model", () => {
    expect(buildPrompt(setup().kit.library)).toContain("A Form may sit in the row");
  });
});

describe("Container", () => {
  it("omits width unless set, and takes the four widths", () => {
    expect((blocks.container("t", [{ type: "divider" }]) as any).width).toBeUndefined();
    for (const w of ["narrow", "standard", "wide", "full"] as const) expect((blocks.container("t", [{ type: "divider" }], { width: w }) as any).width).toBe(w);
    expect((blocks.container("t", [{ type: "divider" }], { width: "huge" as any }) as any).width).toBeUndefined();
  });

  it("renders Section, Tags, Context and an Actions row with a Form, buttons and an input, full width", async () => {
    const { kit } = setup();
    const r = await kit.render(DRAFT);
    const c = r.blocks[0] as any;
    expect(c.type).toBe("container");
    expect(c.width).toBe("full");
    expect(c.child_blocks.map((b: any) => b.type)).toEqual(["section", "rich_text", "context", "actions", "input"]);
    expect(c.child_blocks[3].elements.map((e: any) => e.text.text)).toEqual(["Edit details", "Cancel", "Create"]);
    expect(c.child_blocks[3].elements[2].style).toBe("primary");
    expect(c.child_blocks[4].element.type).toBe("number_input");
    expect(r.controls).toMatchObject({ pts: "input", create: "button" });
  });

  it("is taught to the model", () => {
    const p = buildPrompt(setup().kit.library);
    expect(p).toContain('"full"');
    expect(p).toContain("Actions row of buttons and inputs");
  });

  it("finds a click inside a container: access, lock and required work as at top level", async () => {
    const { kit, events, client } = setup();
    const { ts } = await kit.postCard(client, target, DRAFT, { owner: "U1", placeholder: false, required: [["points"]] });
    // someone else is refused
    const denied: any = await kit.handleAction(client, act(ts, "U2", press("create", "Create")));
    expect(denied.decision.type).toBe("deny");
    // required not met yet
    const early: any = await kit.handleAction(client, act(ts, "U1", press("create", "Create")));
    expect(early.card.locked).toBeUndefined();
    expect(events).toEqual([]);
    // an input inside the container saves, no event
    const set: any = await kit.handleAction(client, act(ts, "U1", { type: "number_input", action_id: "pts", value: "5" }));
    expect(set.card.state.$points).toBe(5);
    expect(events).toEqual([]);
    // the press now locks, and the frozen container shows the number
    const done: any = await kit.handleAction(client, act(ts, "U1", press("create", "Create")));
    expect(done.card.locked).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.state.$done).toBe("create");
    const box = done.card.blocks[0];
    expect(box.type).toBe("container");
    expect(box.child_blocks.some((b: any) => b.type === "input" || (b.type === "actions" && b.elements.some((e: any) => e.action_id === "create")))).toBe(false);
    expect(JSON.stringify(box)).toContain("*Points:* 5");
    // and a later click is refused as locked
    const again: any = await kit.handleAction(client, act(ts, "U1", press("create", "Create")));
    expect(again.decision.type).toBe("locked");
  });

  it("redraws with fresh block ids for inputs inside a container when a change is refused", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, DRAFT, { owner: "U1", placeholder: false });
    client.calls.length = 0;
    await kit.handleAction(client, act(ts, "U2", { type: "number_input", action_id: "pts", value: "9" }));
    const blocks = client.calls.find((c) => c.method === "chat.update")!.args.blocks;
    expect(blocks[0].child_blocks[4].block_id).toMatch(/^r/);
  });

  it("opens the form button inside a container", async () => {
    const { kit, client } = setup();
    const { ts } = await kit.postCard(client, target, DRAFT, { owner: "U1", placeholder: false });
    const id = client.calls.find((c) => c.method === "chat.postMessage")!.args.blocks[0].child_blocks[3].elements[0].action_id;
    await kit.handleAction(client, act(ts, "U1", { type: "button", action_id: id }));
    expect(client.calls.some((c) => c.method === "views.open")).toBe(true);
  });
});

describe("card text clipping", () => {
  it("keeps a mention, a link and an emoji shortcode whole", () => {
    const mention = clipTo(`${"a".repeat(140)}<@U12345678> and more`, 150);
    expect(mention).toBe(`${"a".repeat(140)}…`);
    expect(clipTo(`${"a".repeat(145)}<https://example.com|link> tail`, 150)).toBe(`${"a".repeat(145)}…`);
    expect(clipTo(`${"a".repeat(145)}:white_check_mark: tail`, 150)).toBe(`${"a".repeat(145)}…`);
    expect(clipTo(`${"a".repeat(400)}`, 150)).toHaveLength(150);
  });

  it("does not leave half an emoji", () => {
    const out = clipTo("😀".repeat(200), 150);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(150);
    expect(/[\ud800-\udbff]…$/.test(out)).toBe(false);
  });

  it("leaves a lone < or : that is not a token alone", () => {
    expect(clipTo(`${"a".repeat(140)} 1 < 2 and 3 > ${"b".repeat(50)}`, 150)).toHaveLength(150);
  });
});

describe("card icon", () => {
  it("is kept for an http(s) URL and left out otherwise", () => {
    expect((blocks.card({ title: "a", icon: "https://example.com/i.png" }) as any).icon.image_url).toBe("https://example.com/i.png");
    expect((blocks.card({ title: "a", icon: "http://example.com/i.png" }) as any).icon).toBeDefined();
    for (const bad of ["rocket", ":rocket:", "ftp://x/y", "javascript:alert(1)", "https://"]) expect((blocks.card({ title: "a", icon: bad }) as any).icon).toBeUndefined();
  });
});
