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
