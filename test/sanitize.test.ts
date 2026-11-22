import { describe, expect, it } from "vitest";
import { sanitize } from "../src/sanitize.js";

const md = (text: string) => ({ type: "mrkdwn", text });
const pt = (text: string) => ({ type: "plain_text", text });

describe("sanitize", () => {
  it("drops a header whose text is empty", () => {
    expect(sanitize([{ type: "header", text: pt("") }, { type: "divider" }])).toEqual([{ type: "divider" }]);
  });

  it("treats whitespace-only text as empty", () => {
    expect(sanitize([{ type: "header", text: pt("  \n") }])).toEqual([]);
  });

  it("removes a section's empty text but keeps its fields", () => {
    expect(sanitize([{ type: "section", text: md(""), fields: [md("a")] }])).toEqual([
      { type: "section", fields: [md("a")] },
    ]);
  });

  it("filters empty fields and drops a section left with nothing", () => {
    expect(sanitize([{ type: "section", text: md(""), fields: [md(""), md(" ")] }])).toEqual([]);
  });

  it("keeps a section that still has an accessory", () => {
    const accessory = { type: "button", text: pt("Go"), action_id: "go" };
    expect(sanitize([{ type: "section", text: md(""), accessory }])).toEqual([{ type: "section", accessory }]);
  });

  it("filters empty context elements and drops an empty context", () => {
    expect(sanitize([{ type: "context", elements: [md(""), md("ok")] }])).toEqual([
      { type: "context", elements: [md("ok")] },
    ]);
    expect(sanitize([{ type: "context", elements: [md("")] }])).toEqual([]);
  });

  it("does not change the blocks it was given", () => {
    const input = [{ type: "section", text: md(""), fields: [md("a")] }];
    const copy = structuredClone(input);
    sanitize(input);
    expect(input).toEqual(copy);
  });

  it("caps a message at 50 blocks and a modal at 100", () => {
    const many = Array.from({ length: 120 }, () => ({ type: "divider" }));
    expect(sanitize(many)).toHaveLength(50);
    expect(sanitize(many, "modal")).toHaveLength(100);
  });
});

describe("sanitize inside nested blocks", () => {
  const empty = { type: "section", text: { type: "mrkdwn", text: "" } };
  const ok = { type: "section", text: { type: "mrkdwn", text: "ok" } };

  it("cleans container children and drops a container left empty", () => {
    expect(sanitize([{ type: "container", title: { type: "plain_text", text: "T" }, child_blocks: [empty, ok] }])).toEqual([
      { type: "container", title: { type: "plain_text", text: "T" }, child_blocks: [ok] },
    ]);
    expect(sanitize([{ type: "container", title: { type: "plain_text", text: "T" }, child_blocks: [empty] }])).toEqual([]);
  });

  it("cleans layout items and drops empty rows and layouts", () => {
    expect(sanitize([{ type: "layout", label: "L", rows: [{ items: [{ block: empty }, { block: ok }] }, { items: [{ block: empty }] }] }])).toEqual([
      { type: "layout", label: "L", rows: [{ items: [{ block: ok }] }] },
    ]);
    expect(sanitize([{ type: "layout", label: "L", rows: [{ items: [{ block: empty }] }] }])).toEqual([]);
  });

  it("drops a card with no title and an empty body, and a carousel left with no cards", () => {
    const card = (title: string, body?: string) => ({
      type: "card",
      title: { type: "mrkdwn", text: title },
      ...(body !== undefined ? { body: { type: "mrkdwn", text: body } } : {}),
    });
    expect(sanitize([card("a", " ")])).toEqual([card("a")]);
    expect(sanitize([{ type: "carousel", elements: [card(""), card("b")] }])).toEqual([{ type: "carousel", elements: [card("b")] }]);
    expect(sanitize([{ type: "carousel", elements: [card("")] }])).toEqual([]);
  });
});

describe("sanitize buttons with no label", () => {
  const button = (text: string, id = "b") => ({ type: "button", action_id: id, text: { type: "plain_text", text } });

  it("drops them from actions blocks, cards and data table cells", () => {
    expect(sanitize([{ type: "actions", elements: [button(""), button("Go")] }])).toEqual([{ type: "actions", elements: [button("Go")] }]);
    expect(sanitize([{ type: "actions", elements: [button(" ")] }])).toEqual([]);
    expect(sanitize([{ type: "card", title: { type: "mrkdwn", text: "a" }, actions: [button("")] }])).toEqual([
      { type: "card", title: { type: "mrkdwn", text: "a" } },
    ]);
    const dt = sanitize([{ type: "data_table", caption: "x", rows: [[{ type: "action_cell", element: button("") }]] }]);
    expect(dt[0]!.rows[0][0]).toEqual({ type: "raw_text", text: "" });
  });
});

describe("sanitize options with no label", () => {
  const opt = (value: string, text: string) => ({ text: { type: "plain_text", text }, value });

  it("drops them from inputs, and drops an input left with no options", () => {
    const box = { type: "checkboxes", action_id: "p", options: [opt("api", "api"), opt("web", "")], initial_options: [opt("web", "")] };
    expect(sanitize([{ type: "actions", elements: [box] }])).toEqual([
      { type: "actions", elements: [{ type: "checkboxes", action_id: "p", options: [opt("api", "api")] }] },
    ]);
    const empty = { type: "static_select", action_id: "s", options: [opt("a", "")], initial_option: opt("a", "") };
    expect(sanitize([{ type: "actions", elements: [empty] }])).toEqual([]);
  });
});
