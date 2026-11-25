/**
 * createSlackKit: the runner. It posts cards, then handles clicks and form
 * submits from whatever event source the host uses. It never owns the Slack
 * connection: every call takes the host's Slack client.
 *
 * Order inside a click (see the design doc): load card, decide (rules, cached
 * group lookup), open a form if asked, take the lock with a version check, and
 * only then run slow work (OpenUI Mutation tools), save, redraw and tell the bot.
 */
import { createCardPreview, FORM_CALLBACK_ID, isChartBlock } from "@openuidev/channels/slack";
import type { SlackTools } from "@openuidev/channels/slack";
import type { GroupResolver } from "./access.js";
import { clipTo } from "./blocks.js";
import { applyDecision, blocksOf, lockInfoFor, newOpenUICard } from "./apply.js";
import { controlsFromBlocks, controlsFromRender, stateLabelsFromRender } from "./controls.js";
import { clickFromAction, clickFromSubmission, decide, elementValue, type Click, type Decision } from "./decide.js";
import { slackGroupResolver } from "./groups.js";
import { lockedBlocks } from "./lock.js";
import { createCardEngine, type CardEngine, type Render } from "./openui/engine.js";
import { CardLimitError, CardPlacementError } from "./openui/placement.js";
import { extendLibrary, type ComponentChanges, type SlackLibrary } from "./openui/library.js";
import { withKitComponents } from "./components.js";
import { formModal } from "./modal.js";
import { notificationText } from "./fallback.js";
import { buildPrompt } from "./openui/prompt.js";
import { CardRenderError, failureText, PLACEHOLDER_TEXT, stripFences } from "./openui/ui.js";
import { decodePlainText, sanitize, type Block } from "./sanitize.js";
import { MemoryCardStore } from "./store.js";
import type { Access, CardEvent, CardRecord, CardStore, FormSpec } from "./types.js";

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

/** What the host's loadOptions gets for one search in a SearchSelect. */
export type LoadOptionsArgs = {
  /** The `source` word the card's SearchSelect was written with. */
  source: string;
  /** What the user has typed. */
  query: string;
  card: CardRecord;
  /** Slack user id of the person searching. */
  user: string;
};

/** One choice offered in a SearchSelect. `value` is saved into state; `label` is shown (clipped to 75 characters). */
export type SearchOption = { value: string; label: string };

/** What Slack expects back for a block_suggestion: at most 100 options. */
export type OptionsResponse = { options: Array<{ text: { type: "plain_text"; text: string }; value: string }> };

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
  /**
   * Finds the options for a SearchSelect as the user types. Used by handleOptions. Without it, or if it
   * throws, the dropdown shows no options.
   */
  loadOptions?: (args: LoadOptionsArgs) => Promise<SearchOption[]> | SearchOption[];
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
  answerFirst: "Please answer every question first.",
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
  /** The card's starting $state, merged over the defaults the source declares ($x = ...). */
  state?: Record<string, unknown>;
  /**
   * Answers needed before a click may lock the card. Each inner array is a group of
   * $state variable names (without `$`); a group is met when at least one of them is
   * non-empty. Saved on the card.
   */
  required?: string[][];
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

/** What `updateCard` changes. */
export type UpdateCardOptions = {
  /** New values for $state variables (names with or without the dollar sign). */
  data: Record<string, unknown>;
  /** Variables dropped from the saved state before `data` is applied; every other saved variable is kept. */
  replaceKeys: string[];
  /** OpenUI Lang to draw with instead of the saved source; saved on the card. */
  source?: string;
  /** Replaces the card's click rules (for a template that was edited). The owner is kept. */
  access?: Access;
};

/** How long updateCard waits for a click that is still finishing its lock: TRIES x DELAY ms. */
const FINISH_WAIT_TRIES = 10;
const FINISH_WAIT_DELAY = 100;
const FINISH_STALE_MS = 60_000;

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
  /**
   * Lock an unlocked card without telling the bot: the same locked look as a normal lock, with
   * `note` as the footer instead of "X pressed by". False when the card is missing or already locked.
   * Throws if Slack refuses the message update after the card was locked in the store; the next click
   * on the card redraws it from the store.
   */
  closeCard(client: SlackClient, channel: string, ts: string, opts: { note: string }): Promise<boolean>;
  /**
   * Redraw an OpenUI card in place (chat.update on the same message): its saved source (or
   * `opts.source`, saved on the card) rendered again with the saved state minus `opts.replaceKeys`
   * plus `opts.data`, merged from the card as read on each attempt and saved with a version check.
   * Owner and meta stay; `opts.access` replaces the click rules. A locked card stays locked and keeps
   * its locked look and footer (a closeCard note or a failed-click note included); its controls stay
   * refused. While a click is still finishing its lock it waits about a second, then gives up.
   * False when the card is missing, is not an OpenUI card, has no source, or stayed busy. Throws
   * CardRenderError if the new state can't be rendered, and throws if Slack refuses the update after
   * the card was saved.
   */
  updateCard(client: SlackClient, channel: string, ts: string, opts: UpdateCardOptions): Promise<boolean>;
  handleAction(client: SlackClient, payload: unknown): Promise<ActionResult>;
  handleViewSubmission(client: SlackClient, payload: unknown): Promise<SubmissionResult>;
  /**
   * Answer Slack's block_suggestion payload (a user typing in a SearchSelect) with the JSON Slack
   * expects. Never throws: a refused user, an unknown card, a missing or failing loadOptions all give
   * no options. Pass the client so a user group rule can be checked.
   */
  handleOptions(payload: unknown, client?: SlackClient): Promise<OptionsResponse>;
};

/** A block that holds a checkbox, select, picker or other input Slack keeps state for on screen. */
function holdsInput(b: Block): boolean {
  if ((b as any).type === "container") return ((b as any).child_blocks ?? []).some(holdsInput);
  const isInput = (e: any) => !!e && typeof e.type === "string" && e.type !== "button" && e.type !== "image" && e.type !== "feedback_buttons";
  const blk = b as any;
  if (blk.type === "input") return true;
  if (blk.type === "actions") return (blk.elements ?? []).some(isInput);
  if (blk.type === "section") return isInput(blk.accessory);
  return false;
}

export function createSlackKit(opts: SlackKitOptions = {}): SlackKit {
  const store = opts.store ?? new MemoryCardStore();
  const library: SlackLibrary = extendLibrary(withKitComponents(opts.components));
  const engine: CardEngine = createCardEngine(library, { tools: opts.tools, quiet: opts.quiet, strict: true });
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

  /**
   * Put the stored blocks back, undoing what Slack already changed on the clicker's screen.
   * Slack keeps a tick or a pick on screen when the update carries the same blocks, so each
   * block holding an input gets a new block_id, which makes Slack draw it fresh. The kit never
   * reads block_id on message cards, and the stored blocks stay as they were.
   */
  let redraws = 0;
  const redraw = (client: SlackClient, card: CardRecord) => {
    const fresh = `r${now().getTime().toString(36)}${(++redraws).toString(36)}`;
    const refresh = (b: Block, tag: string): Block =>
      (b as any).type === "container"
        ? { ...b, child_blocks: ((b as any).child_blocks ?? []).map((c: Block, j: number) => refresh(c, `${tag}_${j}`)) }
        : holdsInput(b)
          ? { ...b, block_id: `${fresh}_${tag}` }
          : b;
    const blocks = card.blocks.map((b, i) => refresh(b, String(i)));
    return write(client, card, blocks).catch(() => {});
  };

  // ---------- Events ----------

  async function eventFor(card: CardRecord, decision: Extract<Decision, { type: "apply" }>, error?: string): Promise<CardEvent> {
    const { click } = decision;
    const stateLabels = await stateLabelsOf(card);
    return {
      type: click.submit ? "submit" : "action",
      card: { channel: card.channel, ts: card.ts, ...(card.threadTs ? { threadTs: card.threadTs } : {}) },
      user: click.user,
      control: {
        id: click.actionId,
        kind: decision.kind,
        ...(click.label !== undefined ? { label: click.label } : {}),
        ...(click.labels ? { labels: click.labels } : {}),
        ...(click.submit ? { value: click.submit.values } : click.value !== undefined ? { value: click.value } : {}),
      },
      state: card.state,
      ...(stateLabels ? { stateLabels } : {}),
      ...(card.locked ? { locked: card.locked } : {}),
      ...(card.meta ? { meta: card.meta } : {}),
      ...(error ? { error } : {}),
    };
  }

  /**
   * Shown option text for each $state variable bound to a choice input, read from a fresh render of
   * the card at its current state. Cards of raw blocks keep no state, so they have none.
   */
  async function stateLabelsOf(card: CardRecord): Promise<Record<string, string | string[]> | undefined> {
    if (card.kind !== "openui" || card.source === undefined) return undefined;
    try {
      const r = await previewEngine.renderState(card.source, card.state);
      return stateLabelsFromRender(r, card.state);
    } catch {
      return undefined;
    }
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

  /** A component in a place the library does not accept, or a card over Slack's block limits, becomes a CardRenderError that names it; for anything else this is undefined. */
  const placed = (e: unknown, source: string, ts: string): CardRenderError | undefined =>
    e instanceof CardPlacementError || e instanceof CardLimitError ? new CardRenderError(e.message, { source, ts, cause: e }) : undefined;

  /** $state keys carry a dollar sign. Accept names with or without it. */
  const withDollar = (state?: Record<string, unknown>) =>
    state && Object.fromEntries(Object.entries(state).map(([k, v]) => [k.startsWith("$") ? k : "$" + k, v]));

  /** Render OpenUI Lang without posting. */
  async function render(source: string, state?: Record<string, unknown>) {
    const src = stripFences(source);
    const r = await engine.renderState(src, withDollar(state)).catch((e) => {
      throw placed(e, src, "") ?? e;
    });
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
        required: post.required,
        now,
      });
      await store.put(card, null);
      return { card, ts, source: src };
    };

    if (post.placeholder === false) {
      const src = stripFences(typeof source === "string" ? source : await collect(source));
      const r = await engine.renderState(src, withDollar(post.state)).catch((e) => {
        throw placed(e, src, "") ?? e;
      });
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
      r = await engine.renderState(src, withDollar(post.state));
      await write(client, { channel: target.channel, ts, text: r.text }, blocksOf(r));
    } catch (e: any) {
      const slackError: string | undefined = e?.data?.error;
      const text = failureText(slackError);
      await client.chat
        .update({ channel: target.channel, ts, text, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${text}_` }] }] })
        .catch(() => {});
      throw placed(e, src, ts) ?? new CardRenderError(text, { source: src, ts, slackError, cause: e });
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
      text: args.text ?? notificationText(args.blocks),
      state: {},
      blocks: sanitize(decodePlainText(args.blocks)),
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

  /** Whether a $state value counts as an answer: not null, not blank text, not an empty list. */
  const answered = (v: unknown) => !(v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0));

  /**
   * Checks every required group once the click's own changes are in. The changes come from the
   * card's own rules, run without tools (no slow work yet). `base` is the card with the inputs
   * Slack sent along with the press already in its state, so a lock saves them too.
   */
  /** The check engine has no tools, so OpenUI warns about each skipped Mutation. Hide that when quiet. */
  async function silently<T>(fn: () => Promise<T>): Promise<T> {
    if (!opts.quiet) return fn();
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[openui] mutation")) return;
      warn(...args);
    };
    try {
      return await fn();
    } finally {
      console.warn = warn;
    }
  }

  async function requiredMet(card: CardRecord, click: Click, payload: any): Promise<{ met: boolean; base: CardRecord }> {
    if (!card.required?.length) return { met: true, base: card };
    let base = card;
    let state = card.state;
    if (card.kind === "openui" && card.source !== undefined) {
      try {
        const sent: Record<string, any> = {};
        for (const block of Object.values<any>(payload?.state?.values ?? {})) Object.assign(sent, block);
        for (const [actionId, el] of Object.entries(sent)) {
          if (card.controls[actionId] !== "input" || actionId === click.actionId) continue;
          state = (await silently(() => previewEngine.applyInteraction(card.source!, state, { actionId, value: elementValue(el) }))).state;
        }
        base = { ...card, state };
        const r = await silently(() =>
          click.submit
            ? previewEngine.submitForm(card.source!, state, click.submit.formId, click.submit.values)
            : previewEngine.applyInteraction(card.source!, state, { actionId: click.actionId, value: click.value }),
        );
        state = r.state;
      } catch {
        state = { ...state, ...(click.submit?.values ?? {}) };
      }
    }
    const met = card.required.every((group) => group.some((name) => answered(state[name.startsWith("$") ? name : "$" + name])));
    return { met, base };
  }

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
        const meta = wrapMeta({ channel: card.channel, ts: card.ts, formId: decision.formId });
        const open = (v: Record<string, any>) => client.views.open({ trigger_id: read.triggerId, view: v });
        const opened = open(formModal(spec, meta, callbackId)).catch((e) => {
          // Alert in a modal is not confirmed live. If Slack refuses it, open the form without alerts.
          if (!(spec as any).notices?.length) throw e;
          return open(formModal({ ...spec, notices: [] } as FormSpec, meta, callbackId));
        });
        return { decision, done: opened.then(() => result()) };
      }
      case "apply": {
        if (decision.kind === "feedback") {
          const event = await eventFor(card, decision);
          return { decision, done: decision.notify ? fire(event, card).then(() => result({ event })) : Promise.resolve(result()) };
        }
        let base = card;
        if (decision.lock) {
          const check = await requiredMet(card, read.click, payload);
          base = check.base;
          if (!check.met) {
            if (submit) {
              // Keep what was typed, so closing and reopening the form shows it again.
              const typed = read.click.submit!.values;
              if (card.kind === "openui" && card.source !== undefined && Object.keys(typed).length) {
                const state = { ...base.state, ...typed };
                if (JSON.stringify(state) !== JSON.stringify(card.state)) {
                  const r = await previewEngine.renderState(card.source, state);
                  const kept: CardRecord = {
                    ...card,
                    text: r.text,
                    state: r.state,
                    blocks: blocksOf(r),
                    controls: controlsFromRender(r),
                    forms: r.forms,
                    version: card.version + 1,
                  };
                  if (!(await store.put(kept, card.version))) return retry();
                  return {
                    decision,
                    response: errorsFor(payload, messages.answerFirst),
                    // Draw the saved state on the message too, so values bound there are not stale.
                    done: redraw(client, kept).then(() => result({ card: kept })),
                  };
                }
              }
              return { decision, response: errorsFor(payload, messages.answerFirst), done: Promise.resolve(result()) };
            }
            // Keep what the press carried (text typed without Enter), unlocked, so the redraw doesn't wipe it.
            let shown = card;
            if (base !== card && card.source !== undefined && JSON.stringify(base.state) !== JSON.stringify(card.state)) {
              const r = await previewEngine.renderState(card.source, base.state);
              const kept: CardRecord = {
                ...card,
                text: r.text,
                state: r.state,
                blocks: blocksOf(r),
                controls: controlsFromRender(r),
                forms: r.forms,
                version: card.version + 1,
              };
              if (!(await store.put(kept, card.version))) return retry();
              shown = kept;
            }
            return {
              decision,
              done: (async () => {
                await tell(client, shown, user, messages.answerFirst);
                await redraw(client, shown);
                return result({ card: shown });
              })(),
            };
          }
          const lock = lockInfoFor(decision, now);
          const claim: CardRecord = { ...base, locked: lock, finishing: true, version: card.version + 1 };
          if (!(await store.put(claim, card.version))) return retry();
          return { decision, done: finishLocked(client, base, claim, decision, lock, result) };
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
      const { finishing: _done, ...rest } = claim;
      const failed = { ...lock, afterNote: messages.failedAfterLock };
      next = {
        ...rest,
        locked: failed,
        blocks: sanitize(lockedBlocks(card.blocks, failed, { note: messages.failedAfterLock })),
        version: claim.version + 1,
      };
    }
    // Save with the marker still set, write to Slack, and only then clear it: an updateCard waits for
    // the marker, so it can neither be undone by this save nor be covered by this click's write. If the
    // second save fails the marker stays, and updateCard ignores it once it is old.
    await store.put({ ...next, finishing: true }, claim.version);
    const cleared: CardRecord = { ...next, version: next.version + 1 };
    return finish(client, cleared, decision, result, error, async () => {
      await store.put(cleared, next.version).catch(() => {});
    });
  }

  async function finish(
    client: SlackClient,
    next: CardRecord,
    decision: Extract<Decision, { type: "apply" }>,
    result: (extra?: any) => ActionResult,
    error?: string,
    afterWrite?: () => Promise<void>,
  ): Promise<ActionResult> {
    let updateError: unknown;
    try {
      await write(client, next, next.blocks);
    } catch (e) {
      updateError = e; // the click is committed; the bot must still hear about it
    }
    await afterWrite?.();
    const event = decision.notify || error ? (await eventFor(next, decision, error)) : undefined;
    if (event) await fire(event, next);
    return result({ card: next, ...(event ? { event } : {}), ...(updateError ? { updateError } : {}) });
  }

  async function closeCard(client: SlackClient, channel: string, ts: string, opts: { note: string }): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const card = await store.get(channel, ts);
      if (!card || card.locked) return false;
      const lock = { by: "", at: now().toISOString(), label: "", note: opts.note };
      const closed: CardRecord = {
        ...card,
        locked: lock,
        blocks: sanitize(lockedBlocks(card.blocks, lock, { closedNote: opts.note })),
        version: card.version + 1,
      };
      if (!(await store.put(closed, card.version))) continue;
      await write(client, closed, closed.blocks);
      return true;
    }
    return false;
  }

  async function updateCard(client: SlackClient, channel: string, ts: string, opts: UpdateCardOptions): Promise<boolean> {
    let waited = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const card = await store.get(channel, ts);
      if (!card || card.kind !== "openui" || card.source === undefined) return false;
      if (card.finishing && card.locked && now().getTime() - Date.parse(card.locked.at) < FINISH_STALE_MS) {
        // A click is saving its result; changing the card now would make that save fail.
        if (waited++ >= FINISH_WAIT_TRIES) return false;
        await new Promise((r) => setTimeout(r, FINISH_WAIT_DELAY));
        attempt--;
        continue;
      }
      const src = opts.source === undefined ? card.source : stripFences(opts.source);
      const state: Record<string, unknown> = { ...card.state };
      for (const key of Object.keys(withDollar(Object.fromEntries(opts.replaceKeys.map((k) => [k, 0]))) ?? {})) delete state[key];
      Object.assign(state, withDollar(opts.data));
      const r = await engine.renderState(src, state).catch((e) => {
        throw placed(e, src, ts) ?? e;
      });
      const open = blocksOf(r);
      const lock = card.locked;
      const blocks = lock
        ? sanitize(
            lockedBlocks(open, lock, lock.note !== undefined ? { closedNote: lock.note } : { note: lock.afterNote }),
          )
        : open;
      const { finishing: _stale, ...kept } = card;
      const next: CardRecord = {
        ...kept,
        ...(opts.access ? { access: opts.access } : {}),
        source: src,
        text: r.text,
        state: r.state,
        blocks,
        controls: controlsFromRender(r),
        forms: r.forms,
        version: card.version + 1,
      };
      if (!(await store.put(next, card.version))) continue;
      await write(client, next, next.blocks);
      return true;
    }
    return false;
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

  /** Handle a raw block_suggestion payload. */
  async function handleOptions(payload: unknown, client?: SlackClient): Promise<OptionsResponse> {
    const none: OptionsResponse = { options: [] };
    try {
      const p: any = payload;
      const actionId: unknown = p?.action_id;
      const channel: unknown = p?.channel?.id ?? p?.container?.channel_id;
      const ts: unknown = p?.message?.ts ?? p?.container?.message_ts;
      const user: unknown = p?.user?.id;
      if (typeof actionId !== "string" || typeof channel !== "string" || typeof ts !== "string" || typeof user !== "string") return none;
      if (!opts.loadOptions) return none;
      const card = await store.get(channel, ts);
      if (!card || card.kind !== "openui" || card.source === undefined) return none;
      // The same rule as a click on this control: owner, group, locked.
      const decision = await decide({ user, actionId }, card, { resolveGroup: client ? groupsFor(client) : opts.groups, events: opts.events });
      if (decision.type !== "apply") return none;
      const r = await previewEngine.renderState(card.source, card.state);
      const source = (r.actionMap?.[actionId] as { source?: unknown } | undefined)?.source;
      if (typeof source !== "string") return none;
      const found = await opts.loadOptions({ source, query: typeof p.value === "string" ? p.value : "", card, user });
      const options = (Array.isArray(found) ? found : []).flatMap((o) => {
        const value = o?.value == null ? "" : String(o.value);
        const label = o?.label == null || o.label === "" ? value : String(o.label);
        // Slack refuses the whole response if one value is over 150 characters.
        if (!value || !label || value.length > 150) return [];
        return [{ text: { type: "plain_text" as const, text: clipTo(label, 75) }, value }];
      });
      return { options: options.slice(0, 100) };
    } catch {
      return none;
    }
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
    closeCard,
    updateCard,
    handleAction,
    handleViewSubmission,
    handleOptions,
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
