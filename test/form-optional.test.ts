import { describe, expect, it } from "vitest";
import { createCardEngine } from "../src/openui/engine.js";
import { extendLibrary } from "../src/openui/index.js";
import { KIT_COMPONENTS } from "../src/components.js";
import { formModal } from "../src/modal.js";

const engine = createCardEngine(extendLibrary(KIT_COMPONENTS as any), { quiet: true });

async function modalFor(src: string, state?: Record<string, unknown>) {
  const forms = (await engine.renderState(src, state)).forms;
  const spec = Object.values(forms)[0];
  return formModal(spec as any, "{}", "cb");
}

const inputs = (view: any) => view.blocks.filter((b: any) => b.type === "input");

describe("Form optional fields and empty dropdowns", () => {
  it("marks only the fields named in the fifth argument optional", async () => {
    const view = await modalFor(`root = Root([f])
$title = ""
$points = null
f = Form("Edit", "Save", [TextInput("Title", $title), NumberInput("Points", $points)], null, ["points"])`);
    const [title, points] = inputs(view);
    expect(title.optional).toBeUndefined();
    expect(points.optional).toBe(true);
  });

  it("accepts names with a leading $", async () => {
    const view = await modalFor(`root = Root([f])
$points = null
f = Form("Edit", "Save", [NumberInput("Points", $points)], null, ["$points"])`);
    expect(inputs(view)[0].optional).toBe(true);
  });

  it("keeps every field required without the fifth argument", async () => {
    const view = await modalFor(`root = Root([f])
$title = ""
f = Form("Edit", "Save", [TextInput("Title", $title)])`);
    expect(inputs(view)[0].optional).toBeUndefined();
  });

  it("leaves out a Select or MultiSelect with no options instead of showing a text box", async () => {
    const view = await modalFor(
      `root = Root([f])
$title = ""
$labels = []
$opts = []
$kind = ""
f = Form("Edit", "Save", [TextInput("Title", $title), Alert("Note", "info"), MultiSelect("Labels", $labels, @Each($opts, "o", Option(o, o))), Select("Kind", $kind, [Option("a", "A")])], null, ["labels", "kind"])`,
    );
    const ins = inputs(view);
    expect(ins.map((b: any) => b.label.text)).toEqual(["Title", "Kind"]);
    expect(ins.every((b: any) => b.element.type !== "plain_text_input" || b.label.text === "Title")).toBe(true);
    expect(ins[1].optional).toBe(true);
    // The notice stays between Title and Kind.
    const order = view.blocks.map((b: any) => (b.type === "input" ? b.label.text : "notice"));
    expect(order).toEqual(["Title", "notice", "Kind"]);
  });

  it("renders the MultiSelect when it has options", async () => {
    const view = await modalFor(
      `root = Root([f])
$labels = ["b"]
$opts = ["a", "b"]
f = Form("Edit", "Save", [MultiSelect("Labels", $labels, @Each($opts, "o", Option(o, o)))], null, ["labels"])`,
    );
    const [labels] = inputs(view);
    expect(labels.element.type).toBe("multi_static_select");
    expect(labels.element.initial_options.map((o: any) => o.value)).toEqual(["b"]);
    expect(labels.optional).toBe(true);
  });
});
