import { describe, expect, it } from "vitest";
import { createSlackKit } from "../src/kit.js";
import { isEmptyText } from "../src/sanitize.js";
// @ts-expect-error: a plain JS module shared with the live test script
import { clickCards, renderChecks } from "../scripts/live-cards.mjs";

const kit = createSlackKit({ quiet: true });
const sources: Record<string, string> = { ...renderChecks("U_OWNER"), ...clickCards() };

/** Paths to any mrkdwn or plain_text object with empty text, at any depth. */
function emptyTexts(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => emptyTexts(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return [];
  if (isEmptyText(node)) return [path];
  return Object.entries(node).flatMap(([k, v]) => emptyTexts(v, `${path}.${k}`));
}

describe("half-written and wrong cards", () => {
  it("render every prefix of every live test card without throwing or sending empty text", async () => {
    let renders = 0;
    for (const [name, src] of Object.entries(sources)) {
      for (let i = 1; i <= src.length; i++) {
        const r = await kit.render(src.slice(0, i)).catch((e: Error) => {
          throw new Error(`${name} at ${i}: ${e.message}`);
        });
        expect(emptyTexts(r.blocks), `${name} at ${i}`).toEqual([]);
        renders++;
      }
    }
    expect(renders).toBeGreaterThan(1000);
  });

  it("render wrong shapes without throwing", async () => {
    const wrong = [
      'root = Root([p])\np = Plan("x", t1)\nt1 = TaskCard("a", "complete")',
      'root = Root([t])\nt = Tags("a")',
      'root = Root([c])\nc = Carousel(Card("a"))',
      'root = Root([d])\nd = DataTable("x", "a", "b")',
      'root = Root([l])\nl = Layout("x", [Section("a")])',
      'root = Root([c])\nc = Container("x", "a")',
      'root = Root([t])\nt = Table(["a"], [[{x: 1}]], "left")',
      'root = Root([t])\nt = TaskCard()',
      'root = Root([f])\nf = Form("x", "y", [Alert()])',
    ];
    for (const src of wrong) {
      const r = await kit.render(src);
      expect(emptyTexts(r.blocks), src).toEqual([]);
    }
  });
});
