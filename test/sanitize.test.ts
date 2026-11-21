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
