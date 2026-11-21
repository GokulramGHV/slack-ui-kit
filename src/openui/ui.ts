/**
 * Our copy of OpenUI's Slack glue (createSlackUI in @openuidev/channels 0.1.0,
 * src/slack/ui.ts). OpenUI's version always uses its built-in library, so this
 * one takes a library, which lets new and replaced components render.
 * Behaviour is kept identical to OpenUI's; tests compare the two call by call.
 *
 * Adapted from @openuidev/channels, Copyright (c) 2011-2024 Thesys Inc.,
 * MIT License. See NOTICE.
 */
import { createEngine, MemoryStore } from "@openuidev/channels";
import type { MessageRef, MessageStore, RenderResult } from "@openuidev/channels";
import {
  buildModal,
  createCardPreview,
  inputValue,
  isChartBlock,
  isChartPlaceholder,
  slackChannel,
  viewValues,
} from "@openuidev/channels/slack";
import type { SlackBlock, SlackTools } from "@openuidev/channels/slack";
import { sanitize } from "../sanitize.js";
import type { SlackLibrary } from "./library.js";
import { buildPrompt } from "./prompt.js";

const PLACEHOLDER_TEXT = "Designing your card…";

/**
 * A card that could not be shown. The placeholder message has already been
 * replaced with a short note; `source` is what the model wrote, for debugging.
 */
export class CardRenderError extends Error {
  readonly source: string;
  readonly ts: string;
  /** Slack's error code, such as "invalid_blocks", when Slack refused the card. */
  readonly slackError?: string;
  constructor(message: string, opts: { source: string; ts: string; slackError?: string; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = "CardRenderError";
    this.source = opts.source;
    this.ts = opts.ts;
    this.slackError = opts.slackError;
  }
}

const failureText = (code?: string) => `Couldn't show this card${code ? ` (${code})` : ""}.`;

export type DeliverArgs = {
  client: any;
  channel: string;
  ts: string;
  result: RenderResult<SlackBlock[]>;
};

export type SlackUIOptions = {
  /** The OpenUI library to render with (see extendLibrary). */
  library: SlackLibrary;
  /** Enables Query()/Mutation() in both the prompt and the renderer. */
  tools?: SlackTools;
  /** Where each card's program and state are saved (default: in memory). */
  store?: MessageStore;
  /** Minimum ms between streamed preview updates (default 500). */
  interval?: number;
  /** Extra rules appended to the system prompt. */
  rules?: string[];
  /** Replace how a finished card is written to its message (default: chat.update). */
  deliver?: (args: DeliverArgs) => Promise<void>;
};

export type StreamedCard = RenderResult<SlackBlock[]> & { ts: string; source: string };

export type SlackUI = {
  prompt: string;
  streamCard(
    client: any,
    target: { channel: string; thread_ts?: string },
    textStream: AsyncIterable<string>,
  ): Promise<StreamedCard>;
  handleAction(client: any, payload: unknown): Promise<void>;
  handleViewSubmission(client: any, payload: unknown): Promise<void>;
};

/** Strip a Markdown code fence if the model wrapped its program in one. */
function stripFences(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:[\w-]+)?\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1]! : trimmed).trim();
}

/**
 * Write a finished card. Chart placeholders are dropped. If the workspace
 * rejects native chart blocks, the card is sent without charts.
 */
async function defaultDeliver({ client, channel, ts, result }: DeliverArgs): Promise<void> {
  const blocks = result.output.filter((b) => !isChartPlaceholder(b));
  try {
    await client.chat.update({ channel, ts, text: result.text, blocks });
  } catch (e: any) {
    if (e?.data?.error !== "invalid_blocks" || !blocks.some(isChartBlock)) throw e;
    await client.chat.update({ channel, ts, text: result.text, blocks: blocks.filter((b) => !isChartBlock(b)) });
  }
}

export function createSlackUI(opts: SlackUIOptions): SlackUI {
  const store = opts.store ?? new MemoryStore();
  const deliver = opts.deliver ?? defaultDeliver;
  const channel = { ...slackChannel, library: opts.library };
  const raw = createEngine(channel, { toolProvider: opts.tools?.provider });
  // Every render is cleaned (see sanitize), so neither deliver nor the caller sees empty text.
  const clean = (r: RenderResult<SlackBlock[]>): RenderResult<SlackBlock[]> => ({ ...r, output: sanitize(r.output) });
  const engine = {
    renderState: async (source: string, state?: Record<string, unknown>) => clean(await raw.renderState(source, state)),
    applyInteraction: async (source: string, state: Record<string, unknown>, interaction: Parameters<typeof raw.applyInteraction>[2]) =>
      clean(await raw.applyInteraction(source, state, interaction)),
    submitForm: async (source: string, state: Record<string, unknown>, formId: string, patch: Record<string, unknown>) =>
      clean(await raw.submitForm(source, state, formId, patch)),
  };
  const previewEngine = createEngine(channel, { quiet: true });
  const specs = opts.tools?.specs.map((s) => ({ ...s, outputSchema: s.outputSchema ?? {} }));
  const prompt = buildPrompt(opts.library, { tools: specs, rules: opts.rules });
  const ref = (conversationId: string, messageId: string): MessageRef => ({
    platform: "slack",
    conversationId,
    messageId,
  });

  async function streamCard(
    client: any,
    target: { channel: string; thread_ts?: string },
    textStream: AsyncIterable<string>,
  ): Promise<StreamedCard> {
    const { channel } = target;
    const ts: string = (
      await client.chat.postMessage({
        channel,
        ...(target.thread_ts ? { thread_ts: target.thread_ts } : {}),
        text: PLACEHOLDER_TEXT,
        blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${PLACEHOLDER_TEXT}_` }] }],
      })
    ).ts;
    const preview = createCardPreview(client, channel, ts, (s) => previewEngine.renderState(s), {
      interval: opts.interval,
    });
    let raw = "";
    try {
      for await (const delta of textStream) {
        if (!delta) continue;
        raw += delta;
        preview.push(delta);
      }
    } catch (e) {
      await preview.dispose();
      await client.chat.delete({ channel, ts }).catch(() => {});
      throw e;
    }
    await preview.dispose();
    const source = stripFences(raw);
    let result: RenderResult<SlackBlock[]>;
    try {
      result = await engine.renderState(source);
      await deliver({ client, channel, ts, result });
    } catch (e: any) {
      // OpenUI would leave "Designing your card…" in the thread. Say what happened instead.
      const slackError: string | undefined = e?.data?.error;
      const text = failureText(slackError);
      await client.chat
        .update({ channel, ts, text, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${text}_` }] }] })
        .catch(() => {});
      throw new CardRenderError(text, { source, ts, slackError, cause: e });
    }
    await store.save(ref(channel, ts), { source, state: result.state });
    return { ...result, ts, source };
  }

  async function handleAction(client: any, payload: unknown): Promise<void> {
    const body = payload as any;
    const action = body?.actions?.[0];
    const channel: string | undefined = body?.channel?.id ?? body?.container?.channel_id;
    const ts: string | undefined = body?.message?.ts ?? body?.container?.message_ts;
    if (!action || !channel || !ts) return;
    if (action.url) return;
    const saved = await store.get(ref(channel, ts));
    if (!saved) return;
    const actionId: string = action.action_id;
    if (actionId.startsWith("form:")) {
      if (!body.trigger_id) return;
      const formId = actionId.slice(5);
      const spec = (await engine.renderState(saved.source, saved.state)).forms[formId];
      if (!spec) return;
      const view = buildModal(spec, JSON.stringify({ channel, ts, formId }));
      await client.views.open({ trigger_id: body.trigger_id, view });
      return;
    }
    const result = await engine.applyInteraction(saved.source, saved.state, {
      actionId,
      value: inputValue(action),
    });
    await deliver({ client, channel, ts, result });
    await store.save(ref(channel, ts), { source: saved.source, state: result.state });
  }

  async function handleViewSubmission(client: any, payload: unknown): Promise<void> {
    const view = (payload as any)?.view;
    if (view?.callback_id && view.callback_id !== "openui_form") return;
    let meta: any = {};
    try {
      meta = JSON.parse(view?.private_metadata || "{}");
    } catch {
      return;
    }
    const { channel, ts, formId } = meta;
    if (!channel || !ts || !formId) return;
    const saved = await store.get(ref(channel, ts));
    if (!saved) return;
    const result = await engine.submitForm(saved.source, saved.state, formId, viewValues(view));
    await deliver({ client, channel, ts, result });
    await store.save(ref(channel, ts), { source: saved.source, state: result.state });
  }

  return { prompt, streamCard, handleAction, handleViewSubmission };
}
