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
import { clipTo } from "./blocks.js";
import { applyDecision, blocksOf, lockInfoFor, newOpenUICard } from "./apply.js";
import { controlsFromBlocks, controlsFromRender, stateLabelsFromRender } from "./controls.js";
import { clickFromAction, clickFromSubmission, decide, elementValue } from "./decide.js";
import { slackGroupResolver } from "./groups.js";
import { lockedBlocks } from "./lock.js";
import { createCardEngine } from "./openui/engine.js";
import { CardPlacementError } from "./openui/placement.js";
import { extendLibrary } from "./openui/library.js";
import { withKitComponents } from "./components.js";
import { formModal } from "./modal.js";
import { notificationText } from "./fallback.js";
import { buildPrompt } from "./openui/prompt.js";
import { CardRenderError, failureText, PLACEHOLDER_TEXT, stripFences } from "./openui/ui.js";
import { decodePlainText, sanitize } from "./sanitize.js";
import { MemoryCardStore } from "./store.js";
const DEFAULT_MESSAGES = {
    alreadySubmitted: "This was already submitted.",
    busy: "Someone changed this card at the same moment. Please try again.",
    failedAfterLock: "Something went wrong after this was pressed. The bot has been told.",
    answerFirst: "Please answer every question first.",
};
/** onEvent threw. The click is already saved, so the event is attached for the host to retry. */
export class EventDeliveryError extends Error {
    event;
    card;
    constructor(event, card, cause) {
        super(`onEvent failed: ${cause?.message ?? cause}`, { cause });
        this.name = "EventDeliveryError";
        this.event = event;
        this.card = card;
    }
}
const NOT_HANDLED = { handled: false };
const MAX_ATTEMPTS = 3;
/** A block that holds a checkbox, select, picker or other input Slack keeps state for on screen. */
function holdsInput(b) {
    if (b.type === "container")
        return (b.child_blocks ?? []).some(holdsInput);
    const isInput = (e) => !!e && typeof e.type === "string" && e.type !== "button" && e.type !== "image" && e.type !== "feedback_buttons";
    const blk = b;
    if (blk.type === "input")
        return true;
    if (blk.type === "actions")
        return (blk.elements ?? []).some(isInput);
    if (blk.type === "section")
        return isInput(blk.accessory);
    return false;
}
export function createSlackKit(opts = {}) {
    const store = opts.store ?? new MemoryCardStore();
    const library = extendLibrary(withKitComponents(opts.components));
    const engine = createCardEngine(library, { tools: opts.tools, quiet: opts.quiet, strict: true });
    const previewEngine = createCardEngine(library, { quiet: true });
    const specs = opts.tools?.specs.map((s) => ({ ...s, outputSchema: s.outputSchema ?? {} }));
    const prompt = buildPrompt(library, { tools: specs, rules: opts.rules });
    const now = opts.now ?? (() => new Date());
    const messages = { ...DEFAULT_MESSAGES, ...opts.messages };
    const callbackId = opts.form?.callbackId ?? FORM_CALLBACK_ID;
    const wrapMeta = opts.form?.wrapMeta ?? ((m) => JSON.stringify(m));
    const unwrapMeta = opts.form?.unwrapMeta ?? ((s) => JSON.parse(s));
    const resolvers = new WeakMap();
    const groupsFor = (client) => {
        if (opts.groups)
            return opts.groups;
        if (!client.usergroups)
            return undefined;
        let r = resolvers.get(client);
        if (!r)
            resolvers.set(client, (r = slackGroupResolver(client)));
        return r;
    };
    const ctxFor = (client) => ({ resolveGroup: groupsFor(client), events: opts.events });
    // ---------- Slack writes ----------
    /** Write blocks to the card's message. If the workspace refuses chart blocks, retry without them. */
    async function write(client, card, blocks) {
        try {
            await client.chat.update({ channel: card.channel, ts: card.ts, text: card.text, blocks });
        }
        catch (e) {
            if (e?.data?.error !== "invalid_blocks" || !blocks.some(isChartBlock))
                throw e;
            await client.chat.update({ channel: card.channel, ts: card.ts, text: card.text, blocks: blocks.filter((b) => !isChartBlock(b)) });
        }
    }
    const tell = (client, card, user, text) => client.chat.postEphemeral({ channel: card.channel, user, text, ...(card.threadTs ? { thread_ts: card.threadTs } : {}) });
    /**
     * Put the stored blocks back, undoing what Slack already changed on the clicker's screen.
     * Slack keeps a tick or a pick on screen when the update carries the same blocks, so each
     * block holding an input gets a new block_id, which makes Slack draw it fresh. The kit never
     * reads block_id on message cards, and the stored blocks stay as they were.
     */
    let redraws = 0;
    const redraw = (client, card) => {
        const fresh = `r${now().getTime().toString(36)}${(++redraws).toString(36)}`;
        const refresh = (b, tag) => b.type === "container"
            ? { ...b, child_blocks: (b.child_blocks ?? []).map((c, j) => refresh(c, `${tag}_${j}`)) }
            : holdsInput(b)
                ? { ...b, block_id: `${fresh}_${tag}` }
                : b;
        const blocks = card.blocks.map((b, i) => refresh(b, String(i)));
        return write(client, card, blocks).catch(() => { });
    };
    // ---------- Events ----------
    async function eventFor(card, decision, error) {
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
    async function stateLabelsOf(card) {
        if (card.kind !== "openui" || card.source === undefined)
            return undefined;
        try {
            const r = await previewEngine.renderState(card.source, card.state);
            return stateLabelsFromRender(r, card.state);
        }
        catch {
            return undefined;
        }
    }
    async function fire(event, card) {
        if (!opts.onEvent)
            return;
        try {
            await opts.onEvent(event);
        }
        catch (e) {
            throw new EventDeliveryError(event, card, e);
        }
    }
    // ---------- Posting ----------
    /** A component in a place the library does not accept becomes a CardRenderError that names it; for anything else this is undefined. */
    const placed = (e, source, ts) => e instanceof CardPlacementError ? new CardRenderError(e.message, { source, ts, cause: e }) : undefined;
    /** $state keys carry a dollar sign. Accept names with or without it. */
    const withDollar = (state) => state && Object.fromEntries(Object.entries(state).map(([k, v]) => [k.startsWith("$") ? k : "$" + k, v]));
    /** Render OpenUI Lang without posting. */
    async function render(source, state) {
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
    async function postCard(client, target, source, post) {
        const thread = target.threadTs ? { thread_ts: target.threadTs } : {};
        const save = async (ts, src, r) => {
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
            let ts;
            try {
                ts = (await client.chat.postMessage({ channel: target.channel, ...thread, text: r.text, blocks: blocksOf(r) })).ts;
            }
            catch (e) {
                throw new CardRenderError(failureText(e?.data?.error), { source: src, ts: "", slackError: e?.data?.error, cause: e });
            }
            return save(ts, src, r);
        }
        const ts = (await client.chat.postMessage({
            channel: target.channel,
            ...thread,
            text: PLACEHOLDER_TEXT,
            blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${PLACEHOLDER_TEXT}_` }] }],
        })).ts;
        const preview = createCardPreview(client, target.channel, ts, (s) => previewEngine.renderState(s), { interval: opts.interval });
        let raw = "";
        try {
            for await (const delta of typeof source === "string" ? one(source) : source) {
                if (!delta)
                    continue;
                raw += delta;
                preview.push(delta);
            }
        }
        catch (e) {
            await preview.dispose();
            await client.chat.delete({ channel: target.channel, ts }).catch(() => { });
            throw e;
        }
        await preview.dispose();
        const src = stripFences(raw);
        let r;
        try {
            r = await engine.renderState(src, withDollar(post.state));
            await write(client, { channel: target.channel, ts, text: r.text }, blocksOf(r));
        }
        catch (e) {
            const slackError = e?.data?.error;
            const text = failureText(slackError);
            await client.chat
                .update({ channel: target.channel, ts, text, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: `_${text}_` }] }] })
                .catch(() => { });
            throw placed(e, src, ts) ?? new CardRenderError(text, { source: src, ts, slackError, cause: e });
        }
        return save(ts, src, r);
    }
    /**
     * Register raw blocks the host already posted. Buttons only in v1: inputs on
     * raw cards are classified but their values are not tracked.
     */
    async function registerCard(args) {
        const card = {
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
    const errorsFor = (payload, text) => {
        const blockId = payload?.view?.blocks?.find((b) => b.type === "input")?.block_id;
        return { response_action: "errors", errors: blockId ? { [blockId]: text } : {} };
    };
    /** Whether a $state value counts as an answer: not null, not blank text, not an empty list. */
    const answered = (v) => !(v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0));
    /**
     * Checks every required group once the click's own changes are in. The changes come from the
     * card's own rules, run without tools (no slow work yet). `base` is the card with the inputs
     * Slack sent along with the press already in its state, so a lock saves them too.
     */
    /** The check engine has no tools, so OpenUI warns about each skipped Mutation. Hide that when quiet. */
    async function silently(fn) {
        if (!opts.quiet)
            return fn();
        const warn = console.warn;
        console.warn = (...args) => {
            if (typeof args[0] === "string" && args[0].startsWith("[openui] mutation"))
                return;
            warn(...args);
        };
        try {
            return await fn();
        }
        finally {
            console.warn = warn;
        }
    }
    async function requiredMet(card, click, payload) {
        if (!card.required?.length)
            return { met: true, base: card };
        let base = card;
        let state = card.state;
        if (card.kind === "openui" && card.source !== undefined) {
            try {
                const sent = {};
                for (const block of Object.values(payload?.state?.values ?? {}))
                    Object.assign(sent, block);
                for (const [actionId, el] of Object.entries(sent)) {
                    if (card.controls[actionId] !== "input" || actionId === click.actionId)
                        continue;
                    state = (await silently(() => previewEngine.applyInteraction(card.source, state, { actionId, value: elementValue(el) }))).state;
                }
                base = { ...card, state };
                const r = await silently(() => click.submit
                    ? previewEngine.submitForm(card.source, state, click.submit.formId, click.submit.values)
                    : previewEngine.applyInteraction(card.source, state, { actionId: click.actionId, value: click.value }));
                state = r.state;
            }
            catch {
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
    async function start(client, read, card, payload, attempt = 0) {
        const submit = !!read.click.submit;
        const decision = await decide(read.click, card, ctxFor(client));
        const result = (extra = {}) => ({ handled: true, decision, card, ...extra });
        const user = read.click.user;
        const retry = async () => {
            const fresh = await store.get(card.channel, card.ts);
            if (!fresh)
                return { decision, done: Promise.resolve(result()) };
            if (attempt + 1 < MAX_ATTEMPTS)
                return start(client, read, fresh, payload, attempt + 1);
            if (submit)
                return { decision, response: errorsFor(payload, messages.busy), done: Promise.resolve(result()) };
            return { decision, done: tell(client, card, user, messages.busy).then(() => result()) };
        };
        switch (decision.type) {
            case "ignore":
                return { decision, done: Promise.resolve(result()) };
            case "locked":
                if (submit)
                    return { decision, response: errorsFor(payload, messages.alreadySubmitted), done: Promise.resolve(result()) };
                return {
                    decision,
                    done: (async () => {
                        await tell(client, card, user, messages.alreadySubmitted);
                        await redraw(client, card); // also heals a crash between the lock claim and the final save
                        return result();
                    })(),
                };
            case "deny":
                if (submit)
                    return { decision, response: errorsFor(payload, decision.message), done: Promise.resolve(result()) };
                return {
                    decision,
                    done: (async () => {
                        await tell(client, card, user, decision.message);
                        if (decision.kind === "input")
                            await redraw(client, card);
                        return result();
                    })(),
                };
            case "open-form": {
                const spec = card.forms[decision.formId];
                if (!spec || !read.triggerId)
                    return { decision, done: Promise.resolve(result()) };
                const meta = wrapMeta({ channel: card.channel, ts: card.ts, formId: decision.formId });
                const open = (v) => client.views.open({ trigger_id: read.triggerId, view: v });
                const opened = open(formModal(spec, meta, callbackId)).catch((e) => {
                    // Alert in a modal is not confirmed live. If Slack refuses it, open the form without alerts.
                    if (!spec.notices?.length)
                        throw e;
                    return open(formModal({ ...spec, notices: [] }, meta, callbackId));
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
                            const typed = read.click.submit.values;
                            if (card.kind === "openui" && card.source !== undefined && Object.keys(typed).length) {
                                const state = { ...base.state, ...typed };
                                if (JSON.stringify(state) !== JSON.stringify(card.state)) {
                                    const r = await previewEngine.renderState(card.source, state);
                                    const kept = {
                                        ...card,
                                        text: r.text,
                                        state: r.state,
                                        blocks: blocksOf(r),
                                        controls: controlsFromRender(r),
                                        forms: r.forms,
                                        version: card.version + 1,
                                    };
                                    if (!(await store.put(kept, card.version)))
                                        return retry();
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
                            const kept = {
                                ...card,
                                text: r.text,
                                state: r.state,
                                blocks: blocksOf(r),
                                controls: controlsFromRender(r),
                                forms: r.forms,
                                version: card.version + 1,
                            };
                            if (!(await store.put(kept, card.version)))
                                return retry();
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
                    const claim = { ...base, locked: lock, version: card.version + 1 };
                    if (!(await store.put(claim, card.version)))
                        return retry();
                    return { decision, done: finishLocked(client, base, claim, decision, lock, result) };
                }
                // Not locking: apply, then save with a version check; on conflict start again.
                let next;
                try {
                    next = await applyDecision(card, decision, { engine, now });
                }
                catch (e) {
                    await tell(client, card, user, messages.busy).catch(() => { });
                    throw e;
                }
                if (!(await store.put(next, card.version)))
                    return retry();
                return { decision, done: finish(client, next, decision, result) };
            }
        }
    }
    async function finishLocked(client, card, claim, decision, lock, result) {
        let next;
        let error;
        try {
            next = { ...(await applyDecision(card, decision, { engine, now, lock })), version: claim.version + 1 };
        }
        catch (e) {
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
    async function finish(client, next, decision, result, error) {
        let updateError;
        try {
            await write(client, next, next.blocks);
        }
        catch (e) {
            updateError = e; // the click is committed; the bot must still hear about it
        }
        const event = decision.notify || error ? (await eventFor(next, decision, error)) : undefined;
        if (event)
            await fire(event, next);
        return result({ card: next, ...(event ? { event } : {}), ...(updateError ? { updateError } : {}) });
    }
    async function closeCard(client, channel, ts, opts) {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const card = await store.get(channel, ts);
            if (!card || card.locked)
                return false;
            const lock = { by: "", at: now().toISOString(), label: "", note: opts.note };
            const closed = {
                ...card,
                locked: lock,
                blocks: sanitize(lockedBlocks(card.blocks, lock, { closedNote: opts.note })),
                version: card.version + 1,
            };
            if (!(await store.put(closed, card.version)))
                continue;
            await write(client, closed, closed.blocks);
            return true;
        }
        return false;
    }
    /** Handle a raw block_actions payload. `{ handled: false }` when it isn't a click on a stored card. */
    async function handleAction(client, payload) {
        const read = clickFromAction(payload);
        if (!read)
            return NOT_HANDLED;
        const card = await store.get(read.channel, read.ts);
        if (!card)
            return NOT_HANDLED;
        return (await start(client, read, card, payload)).done;
    }
    /**
     * Handle a raw view_submission payload. Reply to Slack with `response`
     * (within 3 seconds), then await `done`.
     */
    async function handleViewSubmission(client, payload) {
        const read = clickFromSubmission(payload, { callbackId, unwrapMeta });
        if (!read)
            return NOT_HANDLED;
        const card = await store.get(read.channel, read.ts);
        if (!card)
            return { handled: true, done: Promise.resolve({ handled: true }) };
        const started = await start(client, read, card, payload);
        return { handled: true, decision: started.decision, response: started.response, done: started.done };
    }
    /** Handle a raw block_suggestion payload. */
    async function handleOptions(payload, client) {
        const none = { options: [] };
        try {
            const p = payload;
            const actionId = p?.action_id;
            const channel = p?.channel?.id ?? p?.container?.channel_id;
            const ts = p?.message?.ts ?? p?.container?.message_ts;
            const user = p?.user?.id;
            if (typeof actionId !== "string" || typeof channel !== "string" || typeof ts !== "string" || typeof user !== "string")
                return none;
            if (!opts.loadOptions)
                return none;
            const card = await store.get(channel, ts);
            if (!card || card.kind !== "openui" || card.source === undefined)
                return none;
            // The same rule as a click on this control: owner, group, locked.
            const decision = await decide({ user, actionId }, card, { resolveGroup: client ? groupsFor(client) : opts.groups, events: opts.events });
            if (decision.type !== "apply")
                return none;
            const r = await previewEngine.renderState(card.source, card.state);
            const source = r.actionMap?.[actionId]?.source;
            if (typeof source !== "string")
                return none;
            const found = await opts.loadOptions({ source, query: typeof p.value === "string" ? p.value : "", card, user });
            const options = (Array.isArray(found) ? found : []).flatMap((o) => {
                const value = o?.value == null ? "" : String(o.value);
                const label = o?.label == null || o.label === "" ? value : String(o.label);
                // Slack refuses the whole response if one value is over 150 characters.
                if (!value || !label || value.length > 150)
                    return [];
                return [{ text: { type: "plain_text", text: clipTo(label, 75) }, value }];
            });
            return { options: options.slice(0, 100) };
        }
        catch {
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
        getCard: (channel, ts) => store.get(channel, ts),
        closeCard,
        handleAction,
        handleViewSubmission,
        handleOptions,
    };
}
async function* one(text) {
    yield text;
}
async function collect(stream) {
    let s = "";
    for await (const d of stream)
        s += d ?? "";
    return s;
}
//# sourceMappingURL=kit.js.map