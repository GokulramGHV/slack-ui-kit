import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEngine, defineBlockComponent } from "@openuidev/channels";
import { slackChannel } from "@openuidev/channels/slack";
import { buildPrompt, extendLibrary } from "../src/openui/index.js";

// Trial components only: the real Plan, TaskCard and Table come in later steps.
const Step = defineBlockComponent({
  name: "Step",
  description: "One step inside a Steps list.",
  props: z.object({ title: z.string() }),
  render: () => [],
});
const Steps = defineBlockComponent({
  name: "Steps",
  description: "A titled list of steps.",
  props: z.object({ title: z.string(), steps: z.array(Step.ref) }),
  render: ({ props }) => [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${props.title}: ${props.steps.map((s: any) => s.props.title).join(", ")}` },
    },
  ],
});
const Table = defineBlockComponent({
  name: "Table",
  description: "A trial replacement table that takes a caption.",
  props: z.object({ caption: z.string() }),
  render: ({ props }) => [{ type: "section", text: { type: "mrkdwn", text: `table: ${props.caption}` } }],
});

const render = async (library: ReturnType<typeof extendLibrary>, source: string) =>
  (await createEngine({ ...slackChannel, library }).renderState(source, {})).output;

describe("extendLibrary", () => {
  it("adds a parent component whose children are another new component", async () => {
    const lib = extendLibrary({ add: [{ component: Steps, slots: ["Root"] }, Step] });
    const out = await render(lib, 's = Steps("Ship", [Step("Build"), Step("Test")])\nroot = Root([s])');
    expect(out).toEqual([{ type: "section", text: { type: "mrkdwn", text: "Ship: Build, Test" } }]);
    expect(buildPrompt(lib)).toContain("Steps(");
    // Children added without slots must still be taught to Claude.
    expect(buildPrompt(lib)).toContain("Step(title: string)");
  });

  it("replaces a built-in component with override", async () => {
    const lib = extendLibrary({ override: [Table] });
    const out = await render(lib, 't = Table("Totals")\nroot = Root([t])');
    expect(out).toEqual([{ type: "section", text: { type: "mrkdwn", text: "table: Totals" } }]);
    expect(buildPrompt(lib)).toContain("Table(caption");
  });
});
