import { describe, expect, it } from "vitest";
import { MemoryStore } from "@openuidev/channels";
import { createSlackUI as openuiSlackUI } from "@openuidev/channels/slack";
import { z } from "zod";
import { defineBlockComponent } from "@openuidev/channels";
import { createSlackUI, extendLibrary } from "../src/openui/index.js";
import { fakeClient, once } from "./helpers/fake-client.js";
import { SAMPLE_CARD } from "./helpers/sample.js";

const target = { channel: "C1", thread_ts: "1699999999.000001" };

/** Run the same steps against OpenUI's glue and ours; return what each did. */
async function both(steps: (ui: any, client: ReturnType<typeof fakeClient>, ts: string) => Promise<void>) {
  const runs = [];
  for (const make of [
    (store: MemoryStore) => openuiSlackUI({ store, interval: 60_000 }),
    (store: MemoryStore) => createSlackUI({ library: extendLibrary(), store, interval: 60_000 }),
  ]) {
    const store = new MemoryStore();
    const client = fakeClient();
    const ui = make(store);
    const card = await ui.streamCard(client, target, once(SAMPLE_CARD));
    await steps(ui, client, card.ts);
    const saved = await store.get({ platform: "slack", conversationId: "C1", messageId: card.ts });
    runs.push({ calls: client.calls, saved, card, prompt: ui.prompt });
  }
  return runs;
}

const click = (ts: string, action: any) => ({
  type: "block_actions",
  user: { id: "U1" },
  channel: { id: "C1" },
  message: { ts },
  trigger_id: "trig-1",
  actions: [action],
});

describe("createSlackUI (our copy of OpenUI's glue)", () => {
  it("posts and renders a card exactly like OpenUI", async () => {
    const [theirs, ours] = await both(async () => {});
    expect(ours.calls).toEqual(theirs.calls);
    expect(ours.saved).toEqual(theirs.saved);
    expect(ours.card).toEqual(theirs.card);
    expect(ours.prompt).toBe(theirs.prompt);
    const types = ours.card.output.map((b: any) => b.type);
    expect(types).toEqual(["header", "section", "actions", "actions", "actions"]);
  });

  it("handles checkbox and button clicks exactly like OpenUI", async () => {
    const [theirs, ours] = await both(async (ui, client, ts) => {
      await ui.handleAction(client, click(ts, {
        type: "checkboxes",
        action_id: "pick",
        selected_options: [{ value: "alpha" }, { value: "beta" }],
      }));
      await ui.handleAction(client, click(ts, { type: "button", action_id: "go" }));
    });
    expect(ours.calls).toEqual(theirs.calls);
    expect(ours.saved).toEqual(theirs.saved);
    expect((ours.saved as any).state).toMatchObject({ $picks: ["alpha", "beta"], $decision: "go" });
  });

  it("opens a form and takes its submit exactly like OpenUI", async () => {
    const [theirs, ours] = await both(async (ui, client, ts) => {
      await ui.handleAction(client, click(ts, { type: "button", action_id: "form:note" }));
      const view = client.calls.find((c) => c.method === "views.open")!.args.view;
      const blockId = view.blocks[0].block_id;
      const actionId = view.blocks[0].element.action_id;
      await ui.handleViewSubmission(client, {
        type: "view_submission",
        user: { id: "U1" },
        view: {
          ...view,
          state: { values: { [blockId]: { [actionId]: { type: "plain_text_input", value: "looks good" } } } },
        },
      });
    });
    expect(ours.calls).toEqual(theirs.calls);
    expect(ours.saved).toEqual(theirs.saved);
    expect((ours.saved as any).state).toMatchObject({ $comment: "looks good" });
  });
});

describe("createSlackUI with an extended library", () => {
  it("renders a component OpenUI's own glue doesn't know", async () => {
    const Note = defineBlockComponent({
      name: "Note",
      description: "A short note.",
      props: z.object({ text: z.string() }),
      render: ({ props }) => [{ type: "section", text: { type: "mrkdwn", text: `Note: ${props.text}` } }],
    });
    const ui = createSlackUI({ library: extendLibrary({ add: [{ component: Note, slots: ["Root"] }] }) });
    const client = fakeClient();
    const card = await ui.streamCard(client, target, once('n = Note("hi")\nroot = Root([n])'));
    expect(card.output).toEqual([{ type: "section", text: { type: "mrkdwn", text: "Note: hi" } }]);
    expect(ui.prompt).toContain("Note(");
  });
});
