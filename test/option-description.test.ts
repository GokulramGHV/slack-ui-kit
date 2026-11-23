import { describe, expect, it } from "vitest";
import { createCardEngine } from "../src/openui/engine.js";
import { buildPrompt, extendLibrary } from "../src/openui/index.js";
import { KIT_COMPONENTS } from "../src/components.js";
import { sanitize } from "../src/sanitize.js";

const library = extendLibrary(KIT_COMPONENTS);
const engine = createCardEngine(library, { quiet: true });
const render = async (src: string, state?: Record<string, unknown>) => (await engine.renderState(src, state)).output as any[];
const elements = (out: any[]) => out.flatMap((b) => [b.element, b.accessory, ...(b.elements ?? [])].filter(Boolean));

describe("Option description", () => {
  it("is taught to the model", () => {
    expect(buildPrompt(library)).toContain("Option(value, label, description?)");
  });

  it("shows under radio and checkbox options, and stays out when empty", async () => {
    const out = await render(`root = Root([Radio("Pick", $a, [Option("x", "X", "First"), Option("y", "Y"), Option("z", "Z", "")]), Checkboxes("Many", $b, [Option("p", "P", "Pee"), Option("q", "Q")])])
$a = "y"
$b = ["p"]`);
    const [radio, boxes] = elements(out);
    expect(radio.type).toBe("radio_buttons");
    expect(radio.options[0].description).toEqual({ type: "plain_text", text: "First" });
    expect("description" in radio.options[1]).toBe(false);
    expect("description" in radio.options[2]).toBe(false);
    expect(radio.initial_option).toEqual({ ...radio.options[1] });
    expect(boxes.type).toBe("checkboxes");
    expect(boxes.options[0].description).toEqual({ type: "plain_text", text: "Pee" });
    expect(boxes.initial_options).toEqual([boxes.options[0]]);
    expect(() => sanitize(out)).not.toThrow();
  });

  it("is ignored in Select, MultiSelect and Overflow", async () => {
    const out = await render(`root = Root([Select("S", $s, [Option("a", "A", "d")]), MultiSelect("M", $m, [Option("a", "A", "d")]), Overflow("O", $o, [Option("a", "A", "d")])])
$s = ""
$m = []
$o = ""`);
    const els = elements(out);
    expect(els.map((e) => e.type)).toEqual(["static_select", "multi_static_select", "overflow"]);
    for (const e of els) for (const o of e.options) expect("description" in o).toBe(false);
  });

  it("clips a 200 character description to 75 with an ellipsis, and the blocks pass sanitize", async () => {
    const long = "a".repeat(200);
    const out = await render(`root = Root([Radio("Pick", $a, [Option("x", "X", "${long}")])])
$a = ""`);
    const text = elements(out)[0].options[0].description.text as string;
    expect(text).toHaveLength(75);
    expect(text.endsWith("…")).toBe(true);
    expect(sanitize(out)).toEqual(out);
  });

  it("keeps the radio bound to its variable", async () => {
    const r = await engine.applyInteraction(`root = Root([Radio("Pick", $a, [Option("x", "X", "d")])])
$a = ""`, { $a: "" }, { actionId: "el_0", value: "x" });
    expect(r.state.$a).toBe("x");
  });
});
