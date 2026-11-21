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

describe("blocks.table", () => {
  it("writes number cells and column alignment as Slack accepted them, with OpenUI's bold header", () => {
    const t = blocks.table(["Repo", "Commits"], [["api", 12], ["ui", 3]], { align: ["left", "right"] });
    expect(t.column_settings).toEqual(accepted.table_numbers_align.column_settings);
    expect(t.rows.slice(1)).toEqual(accepted.table_numbers_align.rows.slice(1));
    expect(t.rows[0][0]).toEqual({
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "Repo", style: { bold: true } }] }],
    });
  });

  it("leaves out column settings when no alignment is given, and treats unknown alignment as left", () => {
    expect(blocks.table(["a"], [["1"]])).not.toHaveProperty("column_settings");
    expect(blocks.table(["a", "b"], [], { align: ["middle" as any, "center"] }).column_settings).toEqual([{ align: "left" }, { align: "center" }]);
  });
});

describe("blocks.dataTable", () => {
  const button = (id: string) => ({ type: "button", action_id: id, text: { type: "plain_text", text: "Diff" } });

  it("builds the data table shape Slack accepted, with button cells", () => {
    const rows = ["api", "ui", "worker", "auth", "billing"].map((r, i) => [r, i * 3 + 1, button(`dt_${r}`)]);
    expect(blocks.dataTable("Repos ahead of prod", ["Repo", "Commits", "Action"], rows, { pageSize: 3 })).toEqual(accepted.data_table);
  });

  it("keeps to Slack's limits: 200 data rows, 20 columns, 20,000 characters", () => {
    const wide = Array.from({ length: 25 }, (_, i) => `c${i}`);
    const t = blocks.dataTable("Big", wide, Array.from({ length: 250 }, () => wide));
    expect(t.rows).toHaveLength(201);
    expect(t.rows[0]).toHaveLength(20);
    const long = blocks.dataTable("Long", ["text"], Array.from({ length: 200 }, () => ["x".repeat(500)]));
    expect(JSON.stringify(long.rows).length).toBeLessThan(40_000);
    expect(long.rows.reduce((n: number, r: any[]) => n + r.reduce((m, c) => m + (c.text?.length ?? 0), 0), 0)).toBeLessThanOrEqual(20_000);
  });
});
