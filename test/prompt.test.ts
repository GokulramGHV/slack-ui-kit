import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@openuidev/channels/slack";
import { buildPrompt, extendLibrary } from "../src/openui/index.js";

describe("buildPrompt", () => {
  it("matches OpenUI's prompt when nothing is added", () => {
    expect(buildPrompt(extendLibrary())).toBe(buildSystemPrompt());
  });

  it("appends host rules the same way OpenUI does", () => {
    const rules = ["Keep cards short."];
    expect(buildPrompt(extendLibrary(), { rules })).toBe(buildSystemPrompt(undefined, rules));
  });

  it("adds OpenUI's tool rules when tools are given", () => {
    const tools = [
      {
        name: "list_items",
        description: "List items.",
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: { items: { type: "array" } } },
      },
    ];
    const prompt = buildPrompt(extendLibrary(), { tools, rules: ["Keep cards short."] });
    expect(prompt).toBe(buildSystemPrompt(tools, ["Keep cards short."]));
    expect(prompt).toContain("do not invent wrapper fields");
  });
});
