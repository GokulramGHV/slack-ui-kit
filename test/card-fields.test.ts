import { describe, expect, it } from "vitest";
import { blocks } from "../src/blocks.js";
import { buildPrompt } from "../src/openui/index.js";
import { createSlackKit } from "../src/kit.js";

const kit = createSlackKit({ quiet: true });
const first = async (src: string) => (await kit.render(src)).blocks[0] as any;

describe("blocks.card", () => {
  it("keeps the old shape for a title, body and buttons", () => {
    const btn = { type: "button", text: { type: "plain_text", text: "Go" }, action_id: "a" };
    expect(blocks.card({ title: "api", body: "12 changes", actions: [btn] })).toEqual({
      type: "card",
      title: { type: "mrkdwn", text: "api" },
      body: { type: "mrkdwn", text: "12 changes" },
      actions: [btn],
    });
    expect(blocks.card({ title: "api" })).toEqual({ type: "card", title: { type: "mrkdwn", text: "api" } });
  });

  it("adds subtitle, subtext and an image icon", () => {
    expect(blocks.card({ title: "api", subtitle: "main", subtext: "_2h ago_", icon: "https://example.com/i.png" })).toEqual({
      type: "card",
      title: { type: "mrkdwn", text: "api" },
      subtitle: { type: "mrkdwn", text: "main" },
      subtext: { type: "mrkdwn", text: "_2h ago_" },
      icon: { type: "image", image_url: "https://example.com/i.png", alt_text: "api" },
    });
  });

  it("clips title and subtitle at 150 and body and subtext at 200, with an ellipsis", () => {
    const c: any = blocks.card({ title: "t".repeat(300), subtitle: "s".repeat(300), body: "b".repeat(300), subtext: "x".repeat(300) });
    expect(c.title.text).toHaveLength(150);
    expect(c.subtitle.text).toHaveLength(150);
    expect(c.body.text).toHaveLength(200);
    expect(c.subtext.text).toHaveLength(200);
    for (const k of ["title", "subtitle", "body", "subtext"]) expect(c[k].text.endsWith("…")).toBe(true);
    const exact: any = blocks.card({ title: "t".repeat(150), body: "b".repeat(200) });
    expect(exact.title.text).toHaveLength(150);
    expect(exact.title.text.endsWith("…")).toBe(false);
    expect(exact.body.text).toHaveLength(200);
  });

  it("leaves out blank optional fields", () => {
    expect(blocks.card({ title: "a", subtitle: " ", subtext: "", icon: "" })).toEqual({ type: "card", title: { type: "mrkdwn", text: "a" } });
  });
});

describe("Card component", () => {
  it("old 3-arg calls render as before", async () => {
    const b = await first(`root = Root([Card("api", "12 changes", [LinkButton("Docs", "https://example.com")])])`);
    expect(b).toEqual({
      type: "card",
      title: { type: "mrkdwn", text: "api" },
      body: { type: "mrkdwn", text: "12 changes" },
      actions: [{ type: "button", text: { type: "plain_text", text: "Docs" }, action_id: "el_0", url: "https://example.com" }],
    });
  });

  it("takes subtitle, subtext and icon after the buttons", async () => {
    const b = await first(`root = Root([Card("api", "body", null, "main", "_2h ago_", "https://example.com/i.png")])`);
    expect(b.subtitle).toEqual({ type: "mrkdwn", text: "main" });
    expect(b.subtext).toEqual({ type: "mrkdwn", text: "_2h ago_" });
    expect(b.icon).toEqual({ type: "image", image_url: "https://example.com/i.png", alt_text: "api" });
    expect(b.actions).toBeUndefined();
  });

  it("clips long text from a card source", async () => {
    const b = await first(`root = Root([Card("${"t".repeat(200)}", "${"b".repeat(250)}", null, "${"s".repeat(200)}", "${"x".repeat(250)}")])`);
    expect([b.title.text.length, b.subtitle.text.length, b.body.text.length, b.subtext.text.length]).toEqual([150, 150, 200, 200]);
  });

  it("tells the model about the new arguments", () => {
    const p = buildPrompt(kit.library);
    expect(p).toContain("subtitle?");
    expect(p).toContain("subtext?");
    expect(p).toContain("icon?");
  });
});
