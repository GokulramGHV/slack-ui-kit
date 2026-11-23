/**
 * Our copy of OpenUI's Slack glue (createSlackUI in @openuidev/channels 0.1.0,
 * src/slack/ui.ts). OpenUI's version always uses its built-in library, so this
 * one takes a library, which lets new and replaced components render.
 * Behaviour is kept identical to OpenUI's; tests compare the two call by call.
 *
 * Adapted from @openuidev/channels, Copyright (c) 2011-2024 Thesys Inc.,
 * MIT License. See NOTICE.
 */
import { MemoryStore } from "@openuidev/channels";
import { buildModal, createCardPreview, inputValue, isChartBlock, isChartPlaceholder, viewValues, } from "@openuidev/channels/slack";
import { createCardEngine } from "./engine.js";
import { buildPrompt } from "./prompt.js";
export const PLACEHOLDER_TEXT = "Designing your card…";
/**
 * A card that could not be shown. The placeholder message has already been
 * replaced with a short note; `source` is what the model wrote, for debugging.
 */
export class CardRenderError extends Error {
    source;
    ts;
    /** Slack's error code, such as "invalid_blocks", when Slack refused the card. */
    slackError;
    constructor(message, opts) {
        super(message, { cause: opts.cause });
        this.name = "CardRenderError";
        this.source = opts.source;
        this.ts = opts.ts;
        this.slackError = opts.slackError;
    }
}
export const failureText = (code) => `Couldn't show this card${code ? ` (${code})` : ""}.`;
/** Strip a Markdown code fence if the model wrapped its program in one. */
export function stripFences(s) {
    const trimmed = s.trim();
    const fenced = trimmed.match(/^```(?:[\w-]+)?\s*\n([\s\S]*?)\n```$/);
    return (fenced ? fenced[1] : trimmed).trim();
}
/**
 * Write a finished card. Chart placeholders are dropped. If the workspace
 * rejects native chart blocks, the card is sent without charts.
 */
async function defaultDeliver({ client, channel, ts, result }) {
    const blocks = result.output.filter((b) => !isChartPlaceholder(b));
    try {
        await client.chat.update({ channel, ts, text: result.text, blocks });
    }
    catch (e) {
        if (e?.data?.error !== "invalid_blocks" || !blocks.some(isChartBlock))
            throw e;
        await client.chat.update({ channel, ts, text: result.text, blocks: blocks.filter((b) => !isChartBlock(b)) });
    }
}
export function createSlackUI(opts) {
    const store = opts.store ?? new MemoryStore();
    const deliver = opts.deliver ?? defaultDeliver;
    const engine = createCardEngine(opts.library, { tools: opts.tools });
    const previewEngine = createCardEngine(opts.library, { quiet: true });
    const specs = opts.tools?.specs.map((s) => ({ ...s, outputSchema: s.outputSchema ?? {} }));
    const prompt = buildPrompt(opts.library, { tools: specs, rules: opts.rules });
    const ref = (conversationId, messageId) => ({
        platform: "slack",
        conversationId,
        messageId,
    });
    async function streamCard(client, target, textStream) {
        const { channel } = target;
        const ts = (await client.chat.postMessage({
            channel,
            ...(target.thread_ts ? { thread_ts: target.thread_ts } : {}),
            text: PLACEHOLDER_TEXT,
            blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${PLACEHOLDER_TEXT}_` }] }],
        })).ts;
        const preview = createCardPreview(client, channel, ts, (s) => previewEngine.renderState(s), {
            interval: opts.interval,
        });
        let raw = "";
        try {
            for await (const delta of textStream) {
                if (!delta)
                    continue;
                raw += delta;
                preview.push(delta);
            }
        }
        catch (e) {
            await preview.dispose();
            await client.chat.delete({ channel, ts }).catch(() => { });
            throw e;
        }
        await preview.dispose();
        const source = stripFences(raw);
        let result;
        try {
            result = await engine.renderState(source);
            await deliver({ client, channel, ts, result });
        }
        catch (e) {
            // OpenUI would leave "Designing your card…" in the thread. Say what happened instead.
            const slackError = e?.data?.error;
            const text = failureText(slackError);
            await client.chat
                .update({ channel, ts, text, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${text}_` }] }] })
                .catch(() => { });
            throw new CardRenderError(text, { source, ts, slackError, cause: e });
        }
        await store.save(ref(channel, ts), { source, state: result.state });
        return { ...result, ts, source };
    }
    async function handleAction(client, payload) {
        const body = payload;
        const action = body?.actions?.[0];
        const channel = body?.channel?.id ?? body?.container?.channel_id;
        const ts = body?.message?.ts ?? body?.container?.message_ts;
        if (!action || !channel || !ts)
            return;
        if (action.url)
            return;
        const saved = await store.get(ref(channel, ts));
        if (!saved)
            return;
        const actionId = action.action_id;
        if (actionId.startsWith("form:")) {
            if (!body.trigger_id)
                return;
            const formId = actionId.slice(5);
            const spec = (await engine.renderState(saved.source, saved.state)).forms[formId];
            if (!spec)
                return;
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
    async function handleViewSubmission(client, payload) {
        const view = payload?.view;
        if (view?.callback_id && view.callback_id !== "openui_form")
            return;
        let meta = {};
        try {
            meta = JSON.parse(view?.private_metadata || "{}");
        }
        catch {
            return;
        }
        const { channel, ts, formId } = meta;
        if (!channel || !ts || !formId)
            return;
        const saved = await store.get(ref(channel, ts));
        if (!saved)
            return;
        const result = await engine.submitForm(saved.source, saved.state, formId, viewValues(view));
        await deliver({ client, channel, ts, result });
        await store.save(ref(channel, ts), { source: saved.source, state: result.state });
    }
    return { prompt, streamCard, handleAction, handleViewSubmission };
}
//# sourceMappingURL=ui.js.map