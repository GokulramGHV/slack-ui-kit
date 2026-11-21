import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocks } from "../src/blocks.js";

const accepted = JSON.parse(readFileSync(new URL("./fixtures/accepted-blocks.json", import.meta.url), "utf8"));

describe("blocks.plan and blocks.taskCard", () => {
  it("builds the plan shape Slack accepted, numbering tasks", () => {
    expect(
      blocks.plan("Release", [
        { title: "Compare", status: "complete" },
        { title: "Build", status: "in_progress" },
        { title: "Announce", status: "pending" },
      ]),
    ).toEqual(accepted.plan);
  });

  it("builds the task card shape Slack accepted, with details and sources", () => {
    expect(
      blocks.taskCard({
        id: "t1",
        title: "Compared repos",
        status: "complete",
        details: "5 repos checked",
        sources: [{ label: "Slack docs", url: "https://docs.slack.dev/" }],
      }),
    ).toEqual(accepted.task_card_with_source);
  });

  it("writes output as rich text and turns mentions and date tokens into rich text elements", () => {
    const card = blocks.taskCard({ title: "Built", status: "complete", output: "Done by <@U1> at <!date^1795339800^{time}|09:30>" });
    expect(card.output).toEqual({
      type: "rich_text",
      elements: [
        {
          type: "rich_text_section",
          elements: [
            { type: "text", text: "Done by " },
            { type: "user", user_id: "U1" },
            { type: "text", text: " at " },
            { type: "date", timestamp: 1795339800, format: "{time}", fallback: "09:30" },
          ],
        },
      ],
    });
  });

  it("turns an unknown status into pending and caps a plan at 50 tasks", () => {
    expect(blocks.taskCard({ title: "x", status: "done" as any }).status).toBe("pending");
    const many = Array.from({ length: 60 }, (_, i) => ({ title: `Step ${i}`, status: "pending" as const }));
    expect(blocks.plan("Big", many).tasks).toHaveLength(50);
  });

  it("drops empty parts instead of sending empty text", () => {
    const card = blocks.taskCard({ title: "x", status: "complete", details: "  ", sources: [{ label: "", url: "" }] });
    expect(card).toEqual({ type: "task_card", task_id: "t1", title: "x", status: "complete" });
  });
});
