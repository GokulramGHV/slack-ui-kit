#!/usr/bin/env node
/**
 * Live test for step 10. Run by hand, with permission, never in CI.
 *
 *   npm run build
 *   SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... \
 *   SLACK_TEST_CHANNEL=C... SLACK_TEST_OWNER=U... node scripts/live-test.mjs
 *
 * It posts one thread: one reply per component, then cards with each new kind
 * of button (card buttons, data table row buttons, feedback, a form with an
 * Alert). Then it listens over Socket Mode and logs every click: who clicked,
 * what the kit decided, and the event the bot would get. Ctrl+C to stop.
 *
 * Click order: a second person (not SLACK_TEST_OWNER) clicks each card FIRST,
 * to see the refusal. Then the owner clicks, which locks the card. After the
 * lock, everyone gets "already submitted", so refusals can't be seen any more.
 *
 *   --dry   print the calls instead of sending them (no tokens needed)
 *
 * Secrets: pass tokens through the environment only (secure prompt or OneCLI).
 */
import { createInterface } from "node:readline/promises";
import { createSlackKit } from "../dist/index.js";
import { clickCards, renderChecks } from "./live-cards.mjs";

const dry = process.argv.includes("--dry");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// --only=a,b posts just those cards, with no label messages. --thread=TS posts into an existing thread.
const only = flag("only")?.split(",");
const thread = flag("thread");
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
    if (!data.ok) {
      console.log("SLACK FAIL", method, data.error, JSON.stringify(data.response_metadata ?? ""));
      throw Object.assign(new Error(`${method}: ${data.error}`), { data });
    }
    return data;
  };
  const m = (name) => (args) => call(name, args);
  // The alert_retry card: give its alert a level Slack refuses, so the kit's retry
  // (the same trigger_id, no alerts) runs against real Slack.
  const openView = async (args) => {
    const forced = JSON.stringify(args.view ?? {}).includes("FORCE_REFUSE");
    const view = forced ? { ...args.view, blocks: args.view.blocks.map((b) => (b.type === "alert" ? { ...b, level: "bogus" } : b)) } : args.view;
    const r = await call("views.open", { ...args, view });
    console.log("OPEN ok", forced ? "(forced alert was accepted)" : "", view.blocks.filter((b) => b.type === "alert").map((b) => b.level ?? "default").join(","));
    return r;
  };
  return {
    chat: { postMessage: m("chat.postMessage"), update: m("chat.update"), delete: m("chat.delete"), postEphemeral: m("chat.postEphemeral") },
    views: { open: openView },
    usergroups: { users: { list: m("usergroups.users.list") } },
  };
}

// ---------- What to post (scripts/live-cards.mjs) ----------

const pick = (cards) => (only ? Object.fromEntries(Object.entries(cards).filter(([k]) => only.includes(k))) : cards);
const RENDER_CHECKS = pick(renderChecks(owner));
const CLICK_CARDS = pick(clickCards());

// ---------- Run ----------

async function main() {
  const client = slackClient(env("SLACK_BOT_TOKEN"));
  if (!dry && typeof WebSocket === "undefined") throw new Error("Needs Node 22 or newer (built-in WebSocket) to listen for clicks.");
  if (!dry) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const cards = Object.keys(RENDER_CHECKS).length + Object.keys(CLICK_CARDS).length;
    const count = (thread ? 0 : 1) + (only ? cards : 2 * cards);
    const answer = await rl.question(`This posts ${count} messages in one thread in ${channel}. Type yes to go on: `);
    rl.close();
    if (answer.trim() !== "yes") return console.log("Stopped. Nothing was posted.");
  }

  const kit = createSlackKit({
    form: { callbackId: "slack_ui_kit_live_test" },
    onEvent: (e) => console.log("EVENT", JSON.stringify(e)),
  });
  const parent = thread ? { ts: thread } : await client.chat.postMessage({ channel, text: `slack-ui-kit live test ${new Date().toISOString()}` });
  const target = { channel, threadTs: parent.ts };

  const results = [];
  for (const [name, src] of Object.entries({ ...RENDER_CHECKS, ...CLICK_CARDS })) {
    try {
      if (!only) await client.chat.postMessage({ channel, thread_ts: parent.ts, text: name, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `*${name}*` }] }] });
      await kit.postCard(client, target, src, { owner, trusted: true, placeholder: false, meta: { check: name } });
      results.push(["OK  ", name]);
    } catch (e) {
      const data = e.cause?.data ?? e.data;
      results.push(["FAIL", name, e.slackError ?? data?.error ?? e.message, JSON.stringify(data?.response_metadata ?? data ?? "")]);
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

/**
 * Socket Mode with Node's built-in WebSocket. A click is acked at once, then
 * handled, as a host should. A form submit is acked with the kit's reply.
 */
async function listen(appToken, handle) {
  const open = await fetch("https://slack.com/api/apps.connections.open", { method: "POST", headers: { authorization: `Bearer ${appToken}` } }).then((r) => r.json());
  if (!open.ok) throw new Error(`apps.connections.open: ${open.error}`);
  const ws = new WebSocket(open.url);
  const ack = (envelope, payload) => ws.send(JSON.stringify({ envelope_id: envelope.envelope_id, ...(payload ? { payload } : {}) }));
  ws.addEventListener("message", async (msg) => {
    const envelope = JSON.parse(msg.data);
    if (envelope.type === "disconnect") return void ws.close();
    if (!envelope.envelope_id) return;
    const payload = envelope.payload;
    if (envelope.type !== "interactive" || payload?.type !== "view_submission") ack(envelope);
    try {
      const reply = envelope.type === "interactive" ? await handle(payload) : undefined;
      if (payload?.type === "view_submission") ack(envelope, reply);
    } catch (e) {
      console.error("handler error", e);
      if (payload?.type === "view_submission") ack(envelope);
    }
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
