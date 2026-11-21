/**
 * Offline end to end: a generic release request and an announcement go through
 * post, ticks, refusals, a form, the lock and the bot's events with a fake client.
 */
import { describe, expect, it } from "vitest";
import { createSlackKit } from "../src/kit.js";
import type { CardEvent } from "../src/types.js";
import { fakeClient } from "./helpers/fake-client.js";

const REQUEST = `root = Root([hdr, intro, div, svc, acts, notes])
$services = ["api", "web", "worker"]
$choice = ""
$reason = ""
hdr = Header("Release request")
intro = Section("*Requested by:* <@U_OWNER>\\nPick the services to release.")
div = Divider()
svc = Checkboxes("services", $services, [Option("api", "api"), Option("web", "web"), Option("worker", "worker")])
acts = Actions([createBtn, cancelBtn, docs])
createBtn = Button("Create release", Action([@Set($choice, "create")]), "primary")
cancelBtn = Button("Cancel", Action([@Set($choice, "cancel")]), "danger")
docs = LinkButton("Docs", "https://example.com/release-guide")
notes = Form("Add a reason", "Save", [TextInput("Reason", $reason)])`;

const ANNOUNCEMENT = `root = Root([hdr, body, acts])
$acked = false
hdr = Header("Release started")
body = Section("*Status:* " + ($acked ? "Acknowledged" : "Waiting for ack"))
acts = Actions([ackBtn])
ackBtn = Button("Ack", Action([@Set($acked, true)]), "primary")`;

/** Like a model: the program arrives in small pieces. */
async function* chunks(text: string, size = 17) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const at = (ts: string, user: string, action: any) => ({
  type: "block_actions",
  user: { id: user },
  channel: { id: "C_TEST" },
  message: { ts },
  trigger_id: `trig-${user}`,
  actions: [action],
});
const ticks = (values: string[]) => ({ type: "checkboxes", action_id: "svc", selected_options: values.map((value) => ({ value })) });
const button = (id: string, text: string) => ({ type: "button", action_id: id, text: { type: "plain_text", text } });
const text = (blocks: any[]) => JSON.stringify(blocks);

describe("offline end to end", () => {
  it("runs a release request from post to lock", async () => {
    const events: CardEvent[] = [];
    const kit = createSlackKit({
      quiet: true,
      interval: 0,
      now: () => new Date("2026-11-22T09:30:00.000Z"),
      onEvent: (e) => void events.push(e),
    });
    const client = fakeClient();
    expect(kit.prompt).toContain("Checkboxes");

    // 1. Post: placeholder, streamed previews, final card.
    const { ts } = await kit.postCard(client, { channel: "C_TEST", threadTs: "1.0" }, chunks(REQUEST), {
      owner: "U_OWNER",
      meta: { bot: "release-helper" },
    });
    expect(client.calls[0]!.args.text).toBe("Designing your card…");
    let card = (await kit.getCard("C_TEST", ts))!;
    expect(card.controls).toMatchObject({ svc: "input", createBtn: "button", cancelBtn: "button", "form:notes": "form" });
    expect(card.controls).not.toHaveProperty("docs");

    // 2. Someone else unticks a service: refused privately, card redrawn, state kept.
    client.calls.length = 0;
    await kit.handleAction(client, at(ts, "U_OTHER", ticks(["api"])));
    expect(client.calls.map((c) => c.method)).toEqual(["chat.postEphemeral", "chat.update"]);
    expect(client.calls[0]!.args).toMatchObject({ user: "U_OTHER", text: "Only <@U_OWNER> can do this." });
    expect((await kit.getCard("C_TEST", ts))!.state.$services).toEqual(["api", "web", "worker"]);

    // 3. The owner unticks one: saved, no event.
    await kit.handleAction(client, at(ts, "U_OWNER", ticks(["api", "web"])));
    expect((await kit.getCard("C_TEST", ts))!.state.$services).toEqual(["api", "web"]);
    expect(events).toEqual([]);

    // 4. The owner opens the form: only views.open, nothing saved yet.
    client.calls.length = 0;
    await kit.handleAction(client, at(ts, "U_OWNER", { type: "button", action_id: "form:notes" }));
    expect(client.calls.map((c) => c.method)).toEqual(["views.open"]);

    // 5. Someone else presses Create: refused, nothing changes.
    await kit.handleAction(client, at(ts, "U_OTHER", button("createBtn", "Create release")));
    expect((await kit.getCard("C_TEST", ts))!.locked).toBeUndefined();

    // 6. The owner presses Create: locked, event to the bot.
    await kit.handleAction(client, at(ts, "U_OWNER", button("createBtn", "Create release")));
    card = (await kit.getCard("C_TEST", ts))!;
    expect(card.locked).toEqual({ by: "U_OWNER", at: "2026-11-22T09:30:00.000Z", label: "Create release" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "action",
      user: "U_OWNER",
      control: { id: "createBtn", kind: "button", label: "Create release" },
      state: { $services: ["api", "web"], $choice: "create" },
      meta: { bot: "release-helper" },
    });

    // The locked card shows the choice and who pressed, keeps the link, and has no live controls.
    const shown = text(card.blocks);
    expect(shown).toContain("api, web");
    expect(shown).toContain("Create release pressed by <@U_OWNER>");
    expect(shown).toContain("https://example.com/release-guide");
    expect(shown).not.toContain('"checkboxes"');
    expect(shown).not.toContain('"createBtn"');

    // 7. Cancel after the lock: "already submitted", no second event.
    client.calls.length = 0;
    await kit.handleAction(client, at(ts, "U_OWNER", button("cancelBtn", "Cancel")));
    expect(client.calls[0]!.args.text).toBe("This was already submitted.");
    expect(events).toHaveLength(1);
  });

  it("limits an announcement's Ack to a group, using a trusted template", async () => {
    const events: CardEvent[] = [];
    const kit = createSlackKit({
      quiet: true,
      groups: async (group) => (group === "S_RELEASERS" ? ["U_A", "U_B"] : []),
      onEvent: (e) => void events.push(e),
    });
    const client = fakeClient();
    const { ts } = await kit.postCard(client, { channel: "C_TEST" }, ANNOUNCEMENT, {
      owner: "U_OWNER",
      trusted: true,
      placeholder: false,
      access: { byId: { ackBtn: { group: "S_RELEASERS" } } },
    });

    await kit.handleAction(client, at(ts, "U_OWNER", button("ackBtn", "Ack")));
    expect(client.calls.at(-1)!.args.text).toBe("Only people in <!subteam^S_RELEASERS> can do this.");

    await kit.handleAction(client, at(ts, "U_A", button("ackBtn", "Ack")));
    const card = (await kit.getCard("C_TEST", ts))!;
    expect(card.state.$acked).toBe(true);
    expect(text(card.blocks)).toContain("Ack pressed by <@U_A>");
    expect(events).toHaveLength(1);
  });
});
