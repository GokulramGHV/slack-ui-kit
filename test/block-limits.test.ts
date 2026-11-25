import { describe, expect, it } from "vitest";
import { CardLimitError, CardRenderError, createSlackKit } from "../src/index.js";
import { fakeClient } from "./helpers/fake-client.js";

const repos = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `repo-${i}` })));
const card = (n: number) => `root = Root([box])
$repos = ${repos(n)}
box = Container("Deploy request", [rows, left, row], false, false, "full")
rows = @Each($repos, "r", [Section("*" + r.name + "*"), Divider()])
left = Context("x")
row = Actions([Button("Cancel", Action([])), Button("Create", Action([]), "primary")])`;

const kit = () => createSlackKit({ quiet: true });

describe("block limits fail loudly", () => {
  it("errors when a container has more children than Slack allows, naming it", async () => {
    // 6 repos = 12 rows blocks + context + actions = 14 children
    await expect(kit().render(card(6))).rejects.toThrow(
      'Container "Deploy request" has 14 children but Slack allows at most 10; the children past 10 (such as an Actions row of buttons) would be dropped. Shorten the list or split it across Containers.',
    );
    await expect(kit().render(card(6))).rejects.toMatchObject({ cause: expect.any(CardLimitError) });
  });

  it("renders every child, buttons included, at exactly the limit", async () => {
    // 4 repos = 8 + context + actions = 10 children
    const r = await kit().render(card(4));
    const kids = (r.blocks[0] as any).child_blocks;
    expect(kids).toHaveLength(10);
    expect(kids.at(-1).type).toBe("actions");
    expect(kids.at(-1).elements.map((e: any) => e.text.text)).toEqual(["Cancel", "Create"]);
  });

  it("postCard rejects with a CardRenderError and posts nothing", async () => {
    const client = fakeClient();
    const err = await kit().postCard(client, { channel: "C1" }, card(6), { owner: "U1", placeholder: false }).catch((e) => e);
    expect(err).toBeInstanceOf(CardRenderError);
    expect(err.message).toContain("Deploy request");
    expect(client.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(0);
  });

  const cardWith = (n: number) =>
    `$p = ""\nroot = Root([Card("api", "body", [${Array.from({ length: n }, (_, i) => `Button("B${i}", Action([@Set($p, "${i}")]))`).join(", ")}])])`;

  it("errors when a card has more buttons than Slack allows, naming it", async () => {
    await expect(kit().render(cardWith(4))).rejects.toThrow(
      'Card "api" has 4 buttons but Slack allows at most 3; the buttons past 3 would be dropped. Remove some buttons or split them across Cards.',
    );
  });

  it("renders every button at exactly the card limit", async () => {
    const r = await kit().render(cardWith(3));
    expect((r.blocks[0] as any).actions.map((a: any) => a.text.text)).toEqual(["B0", "B1", "B2"]);
  });
});
