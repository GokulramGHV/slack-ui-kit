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

describe("blocks.card and blocks.carousel", () => {
  const open = (id: string) => ({ type: "button", action_id: id, text: { type: "plain_text", text: "Open" } });

  it("build the card and carousel shapes Slack accepted", () => {
    expect(blocks.card({ title: "api", body: "12 commits ahead", actions: [open("card_api")] })).toEqual(accepted.card);
    const cards = [
      ["api", "12 commits"],
      ["ui", "3 commits"],
      ["worker", "1 commit"],
    ].map(([t, b]) => blocks.card({ title: t!, body: b, actions: [open(`card_${t}`)] }));
    expect(blocks.carousel(cards)).toEqual(accepted.carousel);
  });

  it("keep to Slack's limits: 3 buttons per card, 10 cards per carousel", () => {
    expect(blocks.card({ title: "x", actions: [1, 2, 3, 4].map((i) => open(`b${i}`)) }).actions).toHaveLength(3);
    expect(blocks.carousel(Array.from({ length: 12 }, () => blocks.card({ title: "x" }))).elements).toHaveLength(10);
  });

  it("leave out an empty body and empty actions", () => {
    expect(blocks.card({ title: "x", body: " ", actions: [] })).toEqual({ type: "card", title: { type: "mrkdwn", text: "x" } });
  });
});

describe("blocks.container and blocks.layout", () => {
  const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });

  it("build the container and layout shapes Slack accepted", () => {
    expect(blocks.container("Details", [section("Hidden until expanded.")], { collapsible: true, collapsed: true })).toEqual(accepted.container);
    expect(blocks.layout("Summary", [[section("*Stage*\nCompare"), section("*Repos*\n5")]], { gridLines: true })).toEqual(accepted.layout);
  });

  it("keep to Slack's limits: 5 rows of 3 items (a container's children are checked at render, not cut)", () => {
    expect(blocks.container("x", Array.from({ length: 12 }, () => section("a"))).child_blocks).toHaveLength(12);
    const l = blocks.layout("x", Array.from({ length: 7 }, () => Array.from({ length: 4 }, () => section("a"))));
    expect(l.rows).toHaveLength(5);
    expect(l.rows[0].items).toHaveLength(3);
    expect(l).not.toHaveProperty("grid_lines");
  });
});

describe("blocks.feedback, blocks.tags and blocks.alert", () => {
  it("build the feedback buttons shape Slack accepted", () => {
    const fb = blocks.feedback({ actionId: "fb", positive: "Good", negative: "Bad" });
    expect(fb.type).toBe("context_actions");
    expect(fb.elements[0]).toEqual({
      ...accepted.feedback_buttons,
      positive_button: { ...accepted.feedback_buttons.positive_button, value: "positive" },
      negative_button: { ...accepted.feedback_buttons.negative_button, value: "negative" },
    });
  });

  it("build the tag shape Slack accepted, with gray for an unknown color", () => {
    expect(blocks.tags([{ text: "ready", color: "green" }, { text: "skipped", color: "orange" }])).toEqual(accepted.tags);
    expect(blocks.tags([{ text: "x", color: "pink" as any }]).elements[0].elements[0].color).toBe("gray");
  });

  it("build an alert, leaving out a level Slack may not know", () => {
    expect(blocks.alert("2 repos were skipped.", "warning")).toEqual(accepted.alert_refused_in_message);
    expect(blocks.alert("x", "loud" as any)).toEqual({ type: "alert", text: { type: "mrkdwn", text: "x" } });
  });
});

describe("blocks.table with wrong input", () => {
  it("ignores an alignment that isn't a list", () => {
    expect(blocks.table(["a"], [["1"]], { align: "left" as any })).not.toHaveProperty("column_settings");
  });
});

// Slack refuses a raw_text cell with empty text (live test, 2026-11-22).
describe("empty table cells", () => {
  const texts = (b: any) => b.rows.flat().map((c: any) => c.text ?? c.elements?.[0]?.elements?.[0]?.text);

  it("never sends empty text in a table or data table cell", () => {
    for (const b of [blocks.table(["", "Note"], [["api", ""], ["web", null as any]]), blocks.dataTable("x", ["", "Note"], [["api", ""], ["web", null as any]])]) {
      for (const t of texts(b)) expect(String(t).length).toBeGreaterThan(0);
    }
  });
});
