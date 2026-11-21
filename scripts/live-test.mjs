#!/usr/bin/env node
/**
 * Live test for step 10. Run by hand with Gokul, never in CI.
 *
 *   npm run build
 *   SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... \
 *   SLACK_TEST_CHANNEL=C... SLACK_TEST_OWNER=U... node scripts/live-test.mjs
 *
 * It posts one thread: one reply per component, then cards with each new kind
 * of button (card buttons, data table row buttons, feedback, a form with an
 * Alert). Then it listens over Socket Mode and logs every click: who clicked,
 * what the kit decided, and the event the bot would get. Have a second person
 * click too, to see refusals for real. Ctrl+C to stop.
 *
 *   --dry   print the calls instead of sending them (no tokens needed)
 *
 * Secrets: pass tokens through the environment only (secure prompt or OneCLI).
 */
import { createInterface } from "node:readline/promises";
import { createSlackKit } from "../dist/index.js";

const dry = process.argv.includes("--dry");
const env = (name) => {
  const v = process.env[name];
  if (!v && !dry) throw new Error(`Set ${name}.`);
  return v ?? `${name}_DRY`;
};
const channel = env("SLACK_TEST_CHANNEL");
const owner = env("SLACK_TEST_OWNER");

// ---------- A minimal Slack client over fetch ----------

function slackClient(token) {
  let n = 0;
  const call = async (method, args) => {
    if (dry) {
      if (method === "chat.postMessage" && Array.isArray(args.blocks) && !args.blocks.length) throw new Error("empty card");
      console.log(`[dry] ${method}`, JSON.stringify(args).slice(0, 300));
      return { ok: true, ts: `1700000000.${String(++n).padStart(6, "0")}`, users: [] };
    }
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!data.ok) throw Object.assign(new Error(`${method}: ${data.error}`), { data });
    return data;
  };
  const m = (name) => (args) => call(name, args);
  return {
    chat: { postMessage: m("chat.postMessage"), update: m("chat.update"), delete: m("chat.delete"), postEphemeral: m("chat.postEphemeral") },
    views: { open: m("views.open") },
    usergroups: { users: { list: m("usergroups.users.list") } },
  };
}

// ---------- What to post ----------

const RENDER_CHECKS = {
  plan: `root = Root([p])
p = Plan("Release", [t1, t2, t3, t4])
t1 = TaskCard("Compare", "complete", "3 services checked")
t2 = TaskCard("Build", "in_progress")
t3 = TaskCard("Deploy", "pending")
t4 = TaskCard("Notify", "error", null, "Webhook timed out", [Source("Runbook", "https://example.com/runbook")])`,
  task_card_alone_pending: `root = Root([t])
t = TaskCard("Waiting for review", "pending")`,
  table_numbers_align: `root = Root([t])
t = Table(["Service", "Changes"], [["api", 12], ["web", 3]], ["left", "right"])`,
  data_table: `root = Root([d])
d = DataTable("Services", ["Service", "Changes"], [["api", 12], ["web", 3], ["worker", 1], ["auth", 7]], 2)`,
  card_carousel: `root = Root([c])
c = Carousel([Card("api", "12 changes"), Card("web", "3 changes", [LinkButton("Docs", "https://example.com")])])`,
  container: `root = Root([c])
c = Container("Details", [Section("Hidden until expanded."), Tags([Tag("ready", "green")])], true, true)`,
  layout: `root = Root([l])
l = Layout("Summary", [[Section("*Stage*\\nBuild"), Section("*Services*\\n3")], [Section("*Owner*\\n<@${owner}>")]], true)`,
  tags: `root = Root([t])
t = Tags([Tag("ready", "green"), Tag("skipped", "orange"), Tag("blocked", "red")])`,
  feedback: `root = Root([s, f])
s = Section("A bot answer to rate.")
f = Feedback()`,
};

const CLICK_CARDS = {
  card_buttons: `root = Root([h, c])
$picked = ""
h = Section("Card buttons. Owner only. Picked: " + $picked)
c = Carousel([Card("api", "Pick me", [Button("Pick", Action([@Set($picked, "api")]))]), Card("web", "Or me", [Button("Pick", Action([@Set($picked, "web")]))])])`,
  data_table_buttons: `root = Root([h, d])
$row = ""
h = Section("Data table row buttons. Owner only. Row: " + $row)
d = DataTable("Rows", ["Service", ""], [["api", Button("Choose", Action([@Set($row, "api")]))], ["web", Button("Choose", Action([@Set($row, "web")]))]])`,
  feedback_anyone: `root = Root([s, f])
s = Section("Feedback: anyone may press, it never locks.")
f = Feedback("Helpful", "Not helpful")`,
  form_with_alert: `root = Root([s, f])
$note = ""
s = Section("Form with an Alert in the modal. Note: " + $note)
f = Form("Add a note", "Save", [Alert("This is a test alert.", "warning"), TextInput("Note", $note)])`,
};

// ---------- Run ----------

async function main() {
  const client = slackClient(env("SLACK_BOT_TOKEN"));
  if (!dry) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This posts about ${Object.keys(RENDER_CHECKS).length + Object.keys(CLICK_CARDS).length + 1} messages to ${channel}. Type yes to go on: `);
    rl.close();
    if (answer.trim() !== "yes") return console.log("Stopped. Nothing was posted.");
  }

  const kit = createSlackKit({
    form: { callbackId: "slack_ui_kit_live_test" },
    onEvent: (e) => console.log("EVENT", JSON.stringify(e)),
  });
  const parent = await client.chat.postMessage({ channel, text: `slack-ui-kit live test ${new Date().toISOString()}` });
  const target = { channel, threadTs: parent.ts };

  const results = [];
  for (const [name, src] of Object.entries({ ...RENDER_CHECKS, ...CLICK_CARDS })) {
    try {
      await client.chat.postMessage({ channel, thread_ts: parent.ts, text: name, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `*${name}*` }] }] });
      await kit.postCard(client, target, src, { owner, trusted: true, placeholder: false, meta: { check: name } });
      results.push(["OK  ", name]);
    } catch (e) {
      results.push(["FAIL", name, e.slackError ?? e.data?.error ?? e.message, JSON.stringify(e.cause?.data?.response_metadata ?? "")]);
    }
  }
  for (const r of results) console.log(...r);
  if (dry) return;

  console.log("\nListening for clicks. Ctrl+C to stop.");
  await listen(env("SLACK_APP_TOKEN"), async (payload) => {
    if (payload.type === "block_actions") {
      const r = await kit.handleAction(client, payload);
      console.log("CLICK", payload.user?.id, payload.actions?.[0]?.type, payload.actions?.[0]?.action_id, "->", JSON.stringify(r.decision ?? r));
      return undefined;
    }
    if (payload.type === "view_submission") {
      const r = await kit.handleViewSubmission(client, payload);
      console.log("SUBMIT", payload.user?.id, "->", JSON.stringify(r.decision ?? r));
      r.done?.then((d) => console.log("SUBMIT DONE", JSON.stringify(d.decision ?? d)));
      return r.response;
    }
  });
}

/** Socket Mode with Node's built-in WebSocket. Acks each envelope, with the handler's reply as payload. */
async function listen(appToken, handle) {
  const open = await fetch("https://slack.com/api/apps.connections.open", { method: "POST", headers: { authorization: `Bearer ${appToken}` } }).then((r) => r.json());
  if (!open.ok) throw new Error(`apps.connections.open: ${open.error}`);
  const ws = new WebSocket(open.url);
  ws.addEventListener("message", async (msg) => {
    const env = JSON.parse(msg.data);
    if (env.type === "disconnect") return void ws.close();
    if (!env.envelope_id) return;
    let reply;
    try {
      reply = env.type === "interactive" ? await handle(env.payload) : undefined;
    } catch (e) {
      console.error("handler error", e);
    }
    ws.send(JSON.stringify({ envelope_id: env.envelope_id, ...(reply ? { payload: reply } : {}) }));
  });
  ws.addEventListener("close", () => {
    console.log("Socket closed; reconnecting.");
    listen(appToken, handle).catch((e) => console.error(e));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
