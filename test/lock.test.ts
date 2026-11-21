import { describe, expect, it } from "vitest";
import { lockedBlocks } from "../src/lock.js";

const pt = (text: string) => ({ type: "plain_text", text });
const opt = (value: string, text: string) => ({ text: pt(text), value });
const lock = { by: "U2", at: "2026-11-22T10:00:00.000Z", label: "Go" };
const footer = {
  type: "context",
  elements: [{ type: "mrkdwn", text: "Go pressed by <@U2> at <!date^1795341600^{date_short_pretty} at {time}|2026-11-22 10:00 UTC>" }],
};

describe("lockedBlocks", () => {
  it("replaces buttons and inputs with what was chosen, and adds who and when", () => {
    const out = lockedBlocks(
      [
        { type: "header", text: pt("Pick items") },
        {
          type: "actions",
          elements: [
            { type: "checkboxes", action_id: "pick", options: [opt("a", "Alpha"), opt("b", "Beta")], initial_options: [opt("a", "Alpha"), opt("b", "Beta")] },
            { type: "static_select", action_id: "sel", placeholder: pt("Size"), options: [opt("s", "Small")], initial_option: opt("s", "Small") },
          ],
        },
        { type: "actions", elements: [{ type: "button", text: pt("Go"), action_id: "go" }, { type: "button", text: pt("Stop"), action_id: "stop" }] },
      ],
      lock,
    );
    expect(out).toEqual([
      { type: "header", text: pt("Pick items") },
      { type: "section", text: { type: "mrkdwn", text: "*Chosen:* Alpha, Beta\n*Size:* Small" } },
      footer,
    ]);
  });

  it("says none when nothing was chosen", () => {
    const out = lockedBlocks([{ type: "actions", elements: [{ type: "checkboxes", action_id: "pick", options: [opt("a", "A")] }] }], lock);
    expect(out[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "*Chosen:* none" } });
  });

  it("keeps link buttons and feedback buttons", () => {
    const link = { type: "button", text: pt("Docs"), action_id: "docs", url: "https://example.com" };
    const feedback = { type: "context_actions", elements: [{ type: "feedback_buttons", action_id: "fb" }] };
    const out = lockedBlocks([{ type: "actions", elements: [link, { type: "button", text: pt("Go"), action_id: "go" }] }, feedback], lock);
    expect(out).toEqual([{ type: "actions", elements: [link] }, feedback, footer]);
  });

  it("removes an interactive section accessory and keeps the text", () => {
    const out = lockedBlocks(
      [{ type: "section", text: { type: "mrkdwn", text: "Ready?" }, accessory: { type: "button", text: pt("Go"), action_id: "go" } }],
      lock,
    );
    expect(out).toEqual([{ type: "section", text: { type: "mrkdwn", text: "Ready?" } }, footer]);
  });

  it("summarises input blocks by their label", () => {
    const out = lockedBlocks(
      [{ type: "input", label: pt("Tags"), element: { type: "multi_static_select", action_id: "t", initial_options: [opt("x", "Ex")] } }],
      lock,
    );
    expect(out[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "*Tags:* Ex" } });
  });

  it("adds a note under the footer when one is given", () => {
    const out = lockedBlocks([], lock, { note: "Something went wrong after this was pressed." });
    expect(out).toEqual([footer, { type: "context", elements: [{ type: "mrkdwn", text: "Something went wrong after this was pressed." }] }]);
  });

  it("uses 'Submitted' wording for a form submit label", () => {
    const out = lockedBlocks([], { ...lock, label: "" });
    expect(out[0].elements[0].text).toMatch(/^Submitted by <@U2> at /);
  });
});

describe("lockedBlocks with a data table", () => {
  it("turns row buttons into their label and keeps link cells", () => {
    const dt = {
      type: "data_table",
      caption: "Repos",
      rows: [
        [{ type: "raw_text", text: "Repo" }, { type: "raw_text", text: "Action" }],
        [
          { type: "raw_text", text: "api" },
          { type: "action_cell", element: { type: "button", action_id: "el_0", text: { type: "plain_text", text: "Diff" } } },
        ],
        [
          { type: "raw_text", text: "ui" },
          { type: "action_cell", element: { type: "button", action_id: "el_1", url: "https://example.com", text: { type: "plain_text", text: "Open" } } },
        ],
      ],
    };
    const [out] = lockedBlocks([dt], { by: "U1", at: "2026-11-22T10:00:00.000Z", label: "Diff" });
    expect(out.rows[1][1]).toEqual({ type: "raw_text", text: "Diff" });
    expect(out.rows[2][1]).toEqual(dt.rows[2]![1]);
  });
});

describe("lockedBlocks with nested blocks", () => {
  const lock = { by: "U1", at: "2026-11-22T10:00:00.000Z", label: "Open" };
  const btn = (id: string) => ({ type: "button", action_id: id, text: { type: "plain_text", text: "Open" } });
  const link = { type: "button", action_id: "l", url: "https://example.com", text: { type: "plain_text", text: "Docs" } };
  const card = (actions: any[]) => ({ type: "card", title: { type: "mrkdwn", text: "api" }, actions });
  const live = (blocks: any[]) => JSON.stringify(blocks).match(/"action_id":"(el_\d+|pick)"/g) ?? [];

  it("removes card buttons, keeps card links, and drops empty actions", () => {
    const out = lockedBlocks([card([btn("el_0"), link]), card([btn("el_1")])], lock);
    expect(out[0]!.actions).toEqual([link]);
    expect(out[1]).not.toHaveProperty("actions");
  });

  it("goes into carousels, containers and layouts", () => {
    const pick = { type: "static_select", action_id: "pick", placeholder: { type: "plain_text", text: "Service" }, initial_option: { value: "api", text: { type: "plain_text", text: "api" } } };
    const section = { type: "section", text: { type: "mrkdwn", text: "Choose" }, accessory: pick };
    const blocks = [
      { type: "carousel", elements: [card([btn("el_0")]), card([link])] },
      { type: "container", title: { type: "plain_text", text: "More" }, child_blocks: [section] },
      { type: "layout", label: "Grid", rows: [{ items: [{ block: section }, { block: { type: "section", text: { type: "mrkdwn", text: "x" } } }] }] },
    ];
    const out = lockedBlocks(blocks, lock);
    expect(live(out)).toEqual([]);
    expect(out[0]!.elements[1].actions).toEqual([link]);
    expect(out[1]!.child_blocks).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "Choose" } },
      { type: "section", text: { type: "mrkdwn", text: "*Service:* api" } },
    ]);
    expect(out[2]!.rows[0].items[0]).toEqual({ block: { type: "section", text: { type: "mrkdwn", text: "Choose" } } });
  });

  it("keeps feedback buttons", () => {
    const fb = { type: "context_actions", elements: [{ type: "feedback_buttons", action_id: "f" }] };
    expect(lockedBlocks([fb], lock)[0]).toEqual(fb);
  });
});
