/**
 * createSlackKit: the runner. It posts cards, then handles clicks and form
 * submits from whatever event source the host uses. It never owns the Slack
 * connection: every call takes the host's Slack client.
 *
 * Order inside a click (see the design doc): load card, decide (rules, cached
 * group lookup), open a form if asked, take the lock with a version check, and
 * only then run slow work (OpenUI Mutation tools), save, redraw and tell the bot.
 */
import { buildModal, createCardPreview, FORM_CALLBACK_ID, isChartBlock } from "@openuidev/channels/slack";
import type { SlackTools } from "@openuidev/channels/slack";
import type { GroupResolver } from "./access.js";
import { applyDecision, blocksOf, lockInfoFor, newOpenUICard } from "./apply.js";
import { controlsFromBlocks, controlsFromRender } from "./controls.js";
import { clickFromAction, clickFromSubmission, decide, type Click, type Decision } from "./decide.js";
import { slackGroupResolver } from "./groups.js";
import { lockedBlocks } from "./lock.js";
import { createCardEngine, type CardEngine, type Render } from "./openui/engine.js";
import { extendLibrary, type ComponentChanges, type SlackLibrary } from "./openui/library.js";
import { buildPrompt } from "./openui/prompt.js";
import { CardRenderError, failureText, PLACEHOLDER_TEXT, stripFences } from "./openui/ui.js";
import { sanitize, type Block } from "./sanitize.js";
import { MemoryCardStore } from "./store.js";
import type { Access, CardEvent, CardRecord, CardStore } from "./types.js";

/** The Slack methods the kit uses. A Bolt client or @slack/web-api WebClient fits. */
export type SlackClient = {
  chat: {
    postMessage(args: any): Promise<any>;
    update(args: any): Promise<any>;
    delete(args: any): Promise<any>;
    postEphemeral(args: any): Promise<any>;
  };
  views: { open(args: any): Promise<any> };
  usergroups?: { users: { list(args: { usergroup: string }): Promise<{ users?: string[] }> } };
};

/** What the kit puts in a form's hidden data. */
export type FormMeta = { channel: string; ts: string; formId: string };

export type SlackKitOptions = {
  /** Where cards are kept (default: in memory, lost on restart). */
  store?: CardStore;
  /** Slack user group lookup. Default: usergroups.users.list on the click's client, cached 60 s. */
  groups?: GroupResolver;
  /** Components to add to or replace in OpenUI's Slack library. */
  components?: ComponentChanges;
  /** Extra prompt rules. */
  rules?: string[];
  /** OpenUI tools (Query/Mutation), as in OpenUI. */
  tools?: SlackTools;
  /** Called after an allowed click or submit: this is notify_agent. */
  onEvent?: (event: CardEvent) => Promise<void> | void;
  /** "default": buttons, feedback and form submits. "all": input changes too. */
  events?: "default" | "all";
  /** Form callback id and how the form's hidden data is written and read. */
  form?: {
    callbackId?: string;
    wrapMeta?: (meta: FormMeta) => string;
    unwrapMeta?: (privateMetadata: string) => FormMeta;
  };
  /** Minimum ms between streamed preview updates (default 500). */
  interval?: number;
  /** Silence OpenUI's tool call logging. */
  quiet?: boolean;
  /** Text shown to people. */
  messages?: Partial<typeof DEFAULT_MESSAGES>;
  /** Clock, for tests. */
  now?: () => Date;
};

const DEFAULT_MESSAGES = {
  alreadySubmitted: "This was already submitted.",
  busy: "Someone changed this card at the same moment. Please try again.",
  failedAfterLock: "Something went wrong after this was pressed. The bot has been told.",
};

export type PostTarget = { channel: string; threadTs?: string };

export type PostOptions = {
  /** Slack user id of the person the card is for. Owner-only controls are theirs. */
  owner: string;
  access?: Access;
  /** True for templates the host wrote: their control ids may carry rules. */
  trusted?: boolean;
  /** False: render first and post the finished card, with no "Designing your card…" message. */
  placeholder?: boolean;
  /** Host data, returned in every event (bot id, template name and version). */
  meta?: Record<string, unknown>;
};

export type ActionResult =
  | { handled: false }
  | {
      handled: true;
      decision?: Decision;
      card?: CardRecord;
      event?: CardEvent;
      /** Set when the card was saved but writing it to Slack failed. */
      updateError?: unknown;
    };

export type SubmissionResult =
  | { handled: false }
  | {
      handled: true;
      decision?: Decision;
      /** Return this to Slack as the view_submission reply (undefined: close the form). */
      response?: { response_action: "errors"; errors: Record<string, string> };
      /** The rest of the work; await it after replying to Slack. */
      done: Promise<ActionResult>;
    };

/** onEvent threw. The click is already saved, so the event is attached for the host to retry. */
export class EventDeliveryError extends Error {
  readonly event: CardEvent;
  readonly card: CardRecord;
  constructor(event: CardEvent, card: CardRecord, cause: unknown) {
    super(`onEvent failed: ${(cause as Error)?.message ?? cause}`, { cause });
    this.name = "EventDeliveryError";
    this.event = event;
    this.card = card;
  }
}

const NOT_HANDLED = { handled: false } as const;
const MAX_ATTEMPTS = 3;

/** What createSlackKit returns. */
export type SlackKit = {
  /** System prompt for the model, including the added components. */
  prompt: string;
  library: SlackLibrary;
  engine: CardEngine;
  store: CardStore;
  render(source: string, state?: Record<string, unknown>): Promise<{
    blocks: Block[];
    text: string;
    state: Record<string, unknown>;
    controls: CardRecord["controls"];
    forms: CardRecord["forms"];
  }>;
  postCard(
    client: SlackClient,
    target: PostTarget,
    source: string | AsyncIterable<string>,
    post: PostOptions,
  ): Promise<{ card: CardRecord; ts: string; source: string }>;
  registerCard(args: {
    channel: string;
    ts: string;
    threadTs?: string;
    blocks: Block[];
    text?: string;
    owner: string;
    access?: Access;
    meta?: Record<string, unknown>;
  }): Promise<CardRecord>;
  getCard(channel: string, ts: string): Promise<CardRecord | undefined>;
  handleAction(client: SlackClient, payload: unknown): Promise<ActionResult>;
  handleViewSubmission(client: SlackClient, payload: unknown): Promise<SubmissionResult>;
};

export function createSlackKit(opts: SlackKitOptions = {}): SlackKit {
  const store = opts.store ?? new MemoryCardStore();
  const library: SlackLibrary = extendLibrary(opts.components);
  const engine: CardEngine = createCardEngine(library, { tools: opts.tools, quiet: opts.quiet });
  const previewEngine: CardEngine = createCardEngine(library, { quiet: true });
  const specs = opts.tools?.specs.map((s) => ({ ...s, outputSchema: s.outputSchema ?? {} }));
  const prompt = buildPrompt(library, { tools: specs, rules: opts.rules });
  const now = opts.now ?? (() => new Date());
  const messages = { ...DEFAULT_MESSAGES, ...opts.messages };
  const callbackId = opts.form?.callbackId ?? FORM_CALLBACK_ID;
  const wrapMeta = opts.form?.wrapMeta ?? ((m: FormMeta) => JSON.stringify(m));
  const unwrapMeta = opts.form?.unwrapMeta ?? ((s: string) => JSON.parse(s) as FormMeta);

  const resolvers = new WeakMap<object, GroupResolver>();
  const groupsFor = (client: SlackClient): GroupResolver | undefined => {
    if (opts.groups) return opts.groups;
    if (!client.usergroups) return undefined;
    let r = resolvers.get(client);
    if (!r) resolvers.set(client, (r = slackGroupResolver(client as any)));
    return r;
  };
  const ctxFor = (client: SlackClient) => ({ resolveGroup: groupsFor(client), events: opts.events });

  // ---------- Slack writes ----------

  /** Write blocks to the card's message. If the workspace refuses chart blocks, retry without them. */
  async function write(client: SlackClient, card: Pick<CardRecord, "channel" | "ts" | "text">, blocks: Block[]) {
    try {
      await client.chat.update({ channel: card.channel, ts: card.ts, text: card.text, blocks });
    } catch (e: any) {
      if (e?.data?.error !== "invalid_blocks" || !blocks.some(isChartBlock)) throw e;
      await client.chat.update({ channel: card.channel, ts: card.ts, text: card.text, blocks: blocks.filter((b) => !isChartBlock(b)) });
    }
  }

  const tell = (client: SlackClient, card: CardRecord, user: string, text: string) =>
    client.chat.postEphemeral({ channel: card.channel, user, text, ...(card.threadTs ? { thread_ts: card.threadTs } : {}) });

  /** Put the stored blocks back, undoing what Slack already changed on the clicker's screen. */
  const redraw = (client: SlackClient, card: CardRecord) => write(client, card, card.blocks).catch(() => {});

  // ---------- Events ----------

  function eventFor(card: CardRecord, decision: Extract<Decision, { type: "apply" }>, error?: string): CardEvent {
    const { click } = decision;
    return {
      type: click.submit ? "submit" : "action",
      card: { channel: card.channel, ts: card.ts, ...(card.threadTs ? { threadTs: card.threadTs } : {}) },
      user: click.user,
      control: {
        id: click.actionId,
        kind: decision.kind,
        ...(click.label !== undefined ? { label: click.label } : {}),
        ...(click.submit ? { value: click.submit.values } : click.value !== undefined ? { value: click.value } : {}),
      },
      state: card.state,
      ...(card.locked ? { locked: card.locked } : {}),
      ...(card.meta ? { meta: card.meta } : {}),
      ...(error ? { error } : {}),
    };
  }

  async function fire(event: CardEvent, card: CardRecord) {
    if (!opts.onEvent) return;
    try {
      await opts.onEvent(event);
    } catch (e) {
      throw new EventDeliveryError(event, card, e);
    }
  }

  // ---------- Posting ----------

  /** Render OpenUI Lang without posting. */
  async function render(source: string, state?: Record<string, unknown>) {
    const r = await engine.renderState(stripFences(source), state);
    return { blocks: blocksOf(r), text: r.text, state: r.state, controls: controlsFromRender(r), forms: r.forms };
  }

  /**
   * Post a card written in OpenUI Lang (a string, or the model's text stream)
   * and save it. Throws CardRenderError if it can't be shown.
   */
  async function postCard(
    client: SlackClient,
    target: PostTarget,
    source: string | AsyncIterable<string>,
    post: PostOptions,
  ): Promise<{ card: CardRecord; ts: string; source: string }> {
    const thread = target.threadTs ? { thread_ts: target.threadTs } : {};
    const save = async (ts: string, src: string, r: Render) => {
      const card = newOpenUICard({
        channel: target.channel,
        ts,
        threadTs: target.threadTs,
        owner: post.owner,
        source: src,
        render: r,
        access: post.access,
        trusted: post.trusted,
        meta: post.meta,
        now,
      });
      await store.put(card, null);
      return { card, ts, source: src };
    };

    if (post.placeholder === false) {
      const src = stripFences(typeof source === "string" ? source : await collect(source));
      const r = await engine.renderState(src);
      let ts: string;
      try {
        ts = (await client.chat.postMessage({ channel: target.channel, ...thread, text: r.text, blocks: blocksOf(r) })).ts;
      } catch (e: any) {
        throw new CardRenderError(failureText(e?.data?.error), { source: src, ts: "", slackError: e?.data?.error, cause: e });
      }
      return save(ts, src, r);
    }

    const ts: string = (
      await client.chat.postMessage({
        channel: target.channel,
        ...thread,
        text: PLACEHOLDER_TEXT,
        blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${PLACEHOLDER_TEXT}_` }] }],
      })
    ).ts;
    const preview = createCardPreview(client, target.channel, ts, (s) => previewEngine.renderState(s), { interval: opts.interval });
    let raw = "";
    try {
      for await (const delta of typeof source === "string" ? one(source) : source) {
        if (!delta) continue;
        raw += delta;
        preview.push(delta);
      }
    } catch (e) {
      await preview.dispose();
      await client.chat.delete({ channel: target.channel, ts }).catch(() => {});
      throw e;
    }
    await preview.dispose();
    const src = stripFences(raw);
    let r: Render;
    try {
      r = await engine.renderState(src);
      await write(client, { channel: target.channel, ts, text: r.text }, blocksOf(r));
    } catch (e: any) {
      const slackError: string | undefined = e?.data?.error;
      const text = failureText(slackError);
      await client.chat
        .update({ channel: target.channel, ts, text, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${text}_` }] }] })
        .catch(() => {});
      throw new CardRenderError(text, { source: src, ts, slackError, cause: e });
    }
    return save(ts, src, r);
  }

  /**
   * Register raw blocks the host already posted. Buttons only in v1: inputs on
   * raw cards are classified but their values are not tracked.
   */
  async function registerCard(args: {
    channel: string;
    ts: string;
    threadTs?: string;
    blocks: Block[];
    text?: string;
    owner: string;
    access?: Access;
    meta?: Record<string, unknown>;
  }): Promise<CardRecord> {
    const card: CardRecord = {
      channel: args.channel,
      ts: args.ts,
      ...(args.threadTs ? { threadTs: args.threadTs } : {}),
      owner: args.owner,
      access: args.access ?? {},
      trusted: true,
      kind: "blocks",
      text: args.text ?? "card",
      state: {},
      blocks: sanitize(args.blocks),
      controls: controlsFromBlocks(args.blocks),
      forms: {},
      version: 1,
      ...(args.meta ? { meta: args.meta } : {}),
      createdAt: now().toISOString(),
    };
    await store.put(card, null);
    return card;
  }

  // ---------- Clicks ----------

  type Started = { decision?: Decision; response?: Extract<SubmissionResult, { handled: true }>["response"]; done: Promise<ActionResult> };

  const errorsFor = (payload: any, text: string) => {
    const blockId = payload?.view?.blocks?.find((b: any) => b.type === "input")?.block_id;
    return { response_action: "errors" as const, errors: blockId ? { [blockId]: text } : {} };
  };

  /**
   * Decide and do the fast part. For a click that locks, the lock is saved
   * before `done` runs any slow work. A form submit's reply is ready here.
   */
  async function start(
    client: SlackClient,
    read: { channel: string; ts: string; triggerId?: string; click: Click },
    card: CardRecord,
    payload: any,
    attempt = 0,
  ): Promise<Started> {
    const submit = !!read.click.submit;
    const decision = await decide(read.click, card, ctxFor(client));
    const result = (extra: Partial<Extract<ActionResult, { handled: true }>> = {}): ActionResult => ({ handled: true, decision, card, ...extra });
    const user = read.click.user;

    const retry = async (): Promise<Started> => {
      const fresh = await store.get(card.channel, card.ts);
      if (!fresh) return { decision, done: Promise.resolve(result()) };
      if (attempt + 1 < MAX_ATTEMPTS) return start(client, read, fresh, payload, attempt + 1);
      if (submit) return { decision, response: errorsFor(payload, messages.busy), done: Promise.resolve(result()) };
      return { decision, done: tell(client, card, user, messages.busy).then(() => result()) };
    };

    switch (decision.type) {
      case "ignore":
        return { decision, done: Promise.resolve(result()) };
      case "locked":
        if (submit) return { decision, response: errorsFor(payload, messages.alreadySubmitted), done: Promise.resolve(result()) };
        return {
          decision,
          done: (async () => {
            await tell(client, card, user, messages.alreadySubmitted);
            await redraw(client, card); // also heals a crash between the lock claim and the final save
            return result();
          })(),
        };
      case "deny":
        if (submit) return { decision, response: errorsFor(payload, decision.message), done: Promise.resolve(result()) };
        return {
          decision,
          done: (async () => {
            await tell(client, card, user, decision.message);
            if (decision.kind === "input") await redraw(client, card);
            return result();
          })(),
        };
      case "open-form": {
        const spec = card.forms[decision.formId];
        if (!spec || !read.triggerId) return { decision, done: Promise.resolve(result()) };
        const view: any = buildModal(spec as any, wrapMeta({ channel: card.channel, ts: card.ts, formId: decision.formId }));
        view.callback_id = callbackId;
        return { decision, done: client.views.open({ trigger_id: read.triggerId, view }).then(() => result()) };
      }
      case "apply": {
        if (decision.kind === "feedback") {
          const event = eventFor(card, decision);
          return { decision, done: decision.notify ? fire(event, card).then(() => result({ event })) : Promise.resolve(result()) };
        }
        if (decision.lock) {
          const lock = lockInfoFor(decision, now);
          const claim: CardRecord = { ...card, locked: lock, version: card.version + 1 };
          if (!(await store.put(claim, card.version))) return retry();
          return { decision, done: finishLocked(client, card, claim, decision, lock, result) };
        }
        // Not locking: apply, then save with a version check; on conflict start again.
        let next: CardRecord;
        try {
          next = await applyDecision(card, decision, { engine, now });
        } catch (e) {
          await tell(client, card, user, messages.busy).catch(() => {});
          throw e;
        }
        if (!(await store.put(next, card.version))) return retry();
        return { decision, done: finish(client, next, decision, result) };
      }
    }
  }

  async function finishLocked(
    client: SlackClient,
    card: CardRecord,
    claim: CardRecord,
    decision: Extract<Decision, { type: "apply" }>,
    lock: NonNullable<CardRecord["locked"]>,
    result: (extra?: any) => ActionResult,
  ): Promise<ActionResult> {
    let next: CardRecord;
    let error: string | undefined;
    try {
      next = { ...(await applyDecision(card, decision, { engine, now, lock })), version: claim.version + 1 };
    } catch (e: any) {
      // Keep it locked: a tool that threw may still have done its work.
      error = e?.message ?? String(e);
      next = {
        ...claim,
        blocks: sanitize(lockedBlocks(card.blocks, lock, { note: messages.failedAfterLock })),
        version: claim.version + 1,
      };
    }
    await store.put(next, claim.version);
    return finish(client, next, decision, result, error);
  }

  async function finish(
    client: SlackClient,
    next: CardRecord,
    decision: Extract<Decision, { type: "apply" }>,
    result: (extra?: any) => ActionResult,
    error?: string,
  ): Promise<ActionResult> {
    let updateError: unknown;
    try {
      await write(client, next, next.blocks);
    } catch (e) {
      updateError = e; // the click is committed; the bot must still hear about it
    }
    const event = decision.notify || error ? eventFor(next, decision, error) : undefined;
    if (event) await fire(event, next);
    return result({ card: next, ...(event ? { event } : {}), ...(updateError ? { updateError } : {}) });
  }

  /** Handle a raw block_actions payload. `{ handled: false }` when it isn't a click on a stored card. */
  async function handleAction(client: SlackClient, payload: unknown): Promise<ActionResult> {
    const read = clickFromAction(payload);
    if (!read) return NOT_HANDLED;
    const card = await store.get(read.channel, read.ts);
    if (!card) return NOT_HANDLED;
    return (await start(client, read, card, payload)).done;
  }

  /**
   * Handle a raw view_submission payload. Reply to Slack with `response`
   * (within 3 seconds), then await `done`.
   */
  async function handleViewSubmission(client: SlackClient, payload: unknown): Promise<SubmissionResult> {
    const read = clickFromSubmission(payload, { callbackId, unwrapMeta });
    if (!read) return NOT_HANDLED;
    const card = await store.get(read.channel, read.ts);
    if (!card) return { handled: true, done: Promise.resolve({ handled: true }) };
    const started = await start(client, read, card, payload);
    return { handled: true, decision: started.decision, response: started.response, done: started.done };
  }

  return {
    prompt,
    library,
    engine,
    store,
    render,
    postCard,
    registerCard,
    getCard: (channel: string, ts: string) => store.get(channel, ts),
    handleAction,
    handleViewSubmission,
  };
}


async function* one(text: string) {
  yield text;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let s = "";
  for await (const d of stream) s += d ?? "";
  return s;
}
