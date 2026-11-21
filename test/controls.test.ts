import { describe, expect, it } from "vitest";
import { controlsFromBlocks, controlsFromRender } from "../src/controls.js";

const btn = (action_id: string, extra = {}) => ({ type: "button", text: { type: "plain_text", text: "B" }, action_id, ...extra });

describe("controlsFromRender", () => {
  it("takes buttons and inputs from OpenUI's actionMap and forms from its forms", () => {
    const controls = controlsFromRender({
      output: [],
      actionMap: {
        go: { kind: "action", plan: { steps: [] } },
        pick: { kind: "input", target: "$picks" },
      },
      forms: { note: { title: "Note", submit: "Save", fields: [] } },
    } as any);
    expect(controls).toEqual({ go: "button", pick: "input", "form:note": "form" });
  });

  it("marks feedback buttons from the Slack element type, whatever their id", () => {
    const controls = controlsFromRender({
      output: [{ type: "context_actions", elements: [{ type: "feedback_buttons", action_id: "anything" }] }],
      actionMap: {},
      forms: {},
    } as any);
    expect(controls).toEqual({ anything: "feedback" });
  });
});

describe("controlsFromBlocks", () => {
  it("classifies raw blocks by Slack element type and skips link buttons", () => {
    const controls = controlsFromBlocks([
      { type: "actions", elements: [btn("go"), btn("docs", { url: "https://example.com" }), { type: "checkboxes", action_id: "pick" }] },
      { type: "section", text: { type: "mrkdwn", text: "x" }, accessory: { type: "static_select", action_id: "sel" } },
      { type: "context_actions", elements: [{ type: "feedback_buttons", action_id: "fb" }] },
    ]);
    expect(controls).toEqual({ go: "button", pick: "input", sel: "input", fb: "feedback" });
  });

  it("finds controls nested inside other blocks", () => {
    const controls = controlsFromBlocks([
      { type: "container", child_blocks: [{ type: "actions", elements: [btn("inner")] }] },
    ]);
    expect(controls).toEqual({ inner: "button" });
  });
});
