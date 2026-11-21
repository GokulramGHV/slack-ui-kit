import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCardEngine } from "../src/openui/engine.js";
import { buildPrompt, extendLibrary } from "../src/openui/index.js";
import { KIT_COMPONENTS } from "../src/components.js";

const accepted = JSON.parse(readFileSync(new URL("./fixtures/accepted-blocks.json", import.meta.url), "utf8"));
const library = extendLibrary(KIT_COMPONENTS);
const engine = createCardEngine(library, { quiet: true });
const render = async (src: string, state?: Record<string, unknown>) => (await engine.renderState(src, state)).output;

describe("Plan and TaskCard", () => {
  it("are taught to Claude", () => {
    const prompt = buildPrompt(library);
    expect(prompt).toContain("Plan(");
    expect(prompt).toContain("TaskCard(");
    expect(prompt).toContain("Source(");
  });

  it("render a plan, using statement names as task ids", async () => {
    const out = await render(`root = Root([p])
p = Plan("Release", [t1, t2, t3])
t1 = TaskCard("Compare", "complete")
t2 = TaskCard("Build", "in_progress")
t3 = TaskCard("Announce", "pending")`);
    expect(out).toEqual([accepted.plan]);
  });

  it("render a task card on its own, with sources and state in its text", async () => {
    const out = await render(`root = Root([t1])
$n = 5
t1 = TaskCard("Compared repos", "complete", "" + $n + " repos checked", null, [Source("Slack docs", "https://docs.slack.dev/")])`);
    expect(out).toEqual([accepted.task_card_with_source]);
  });

  it("render nothing while a plan is still being written", async () => {
    expect(await render(`root = Root([p])
p = Plan("Release", [])`)).toEqual([]);
    expect(await render(`root = Root([p])
p = Plan("Rel`)).toEqual([]);
  });
});

describe("Table", () => {
  it("renders a plain string table exactly like OpenUI's own Table", async () => {
    const stock = createCardEngine(extendLibrary(), { quiet: true });
    const src = `root = Root([t])
t = Table(["Title", "Priority"], [["Fix login", "High"], ["Write docs", "Low"]])`;
    expect(await render(src)).toEqual((await stock.renderState(src)).output);
  });

  it("adds number cells and alignment", async () => {
    const [t] = (await render(`root = Root([t])
t = Table(["Repo", "Commits"], [["api", 12], ["ui", 3]], ["left", "right"])`)) as any[];
    expect(t.column_settings).toEqual(accepted.table_numbers_align.column_settings);
    expect(t.rows.slice(1)).toEqual(accepted.table_numbers_align.rows.slice(1));
  });
});

describe("DataTable", () => {
  const SRC = `root = Root([dt])
$repo = ""
dt = DataTable("Repos ahead of prod", ["Repo", "Commits", "Action"], [
  ["api", 1, Button("Diff", Action([@Set($repo, "api")]))],
  ["ui", 4, Button("Diff", Action([@Set($repo, "ui")]))]
], 3)`;

  it("renders a data table whose row buttons are registered as buttons", async () => {
    const r = await engine.renderState(SRC);
    const [dt] = r.output as any[];
    expect(dt).toMatchObject({ type: "data_table", caption: "Repos ahead of prod", page_size: 3 });
    expect(dt.rows[1]).toEqual([
      { type: "raw_text", text: "api" },
      { type: "raw_number", value: 1, text: "1" },
      { type: "action_cell", element: { type: "button", action_id: "el_0", text: { type: "plain_text", text: "Diff" } } },
    ]);
    expect(Object.keys(r.actionMap)).toEqual(["el_0", "el_1"]);
    expect((await engine.applyInteraction(SRC, r.state, { actionId: "el_1" })).state.$repo).toBe("ui");
  });

  it("tells Claude to name the row in each button's action", () => {
    expect(buildPrompt(library)).toMatch(/DataTable[^\n]*@Set/);
  });

  it("renders nothing until it has a caption and a row", async () => {
    expect(await render(`root = Root([dt])
dt = DataTable("", ["a"], [["1"]])`)).toEqual([]);
    expect(await render(`root = Root([dt])
dt = DataTable("Repos", ["a"], [])`)).toEqual([]);
  });
});
