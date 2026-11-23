import { inputValue, viewValues } from "@openuidev/channels/slack";
import { isAllowed, refusalText, ruleFor } from "./access.js";
/** Whether this click freezes the card under its lock policy. */
function locks(card, click, kind) {
    const submitStyle = kind === "button" || (kind === "form" && !!click.submit);
    const policy = card.access.lock ?? "buttons";
    if (policy === "never")
        return false;
    if (policy !== "buttons" && card.trusted)
        return policy.ids.includes(click.actionId);
    return submitStyle; // "buttons", or an id list on an untrusted card (ignored)
}
/**
 * Decide what a click means: ignore, already locked, deny, open a form, or
 * apply. Makes no Slack calls; the only outside call is the group lookup.
 */
export async function decide(click, card, ctx = {}) {
    if (click.url)
        return { type: "ignore", click, reason: "link" };
    const kind = card.controls[click.actionId];
    if (!kind)
        return { type: "ignore", click, reason: "unknown-control" };
    if (card.locked && kind !== "feedback")
        return { type: "locked", click };
    const rule = ruleFor(card, { id: click.actionId, kind });
    if (!(await isAllowed(rule, click.user, card.owner, ctx.resolveGroup))) {
        return { type: "deny", click, kind, rule, message: refusalText(rule, card.owner) };
    }
    if (kind === "form" && !click.submit)
        return { type: "open-form", click, formId: click.actionId.slice("form:".length) };
    const notify = kind !== "input" || ctx.events === "all";
    return { type: "apply", click, kind, lock: kind !== "feedback" && locks(card, click, kind), notify };
}
/** Shown text of the options an input element has chosen. Undefined when it has none. */
function chosenLabels(el) {
    const text = (o) => (typeof o?.text?.text === "string" ? o.text.text : undefined);
    switch (el?.type) {
        case "static_select":
        case "radio_buttons":
        case "overflow":
            return text(el.selected_option);
        case "multi_static_select":
        case "checkboxes": {
            const all = (el.selected_options ?? []).map(text).filter((t) => t !== undefined);
            return all.length ? all : undefined;
        }
        default:
            return undefined;
    }
}
/** Labels for the fields of a submitted modal, keyed like the submit values. Undefined when none. */
function viewLabels(view, values) {
    const out = {};
    const state = view?.state?.values ?? {};
    for (const blockId of Object.keys(state)) {
        for (const actionId of Object.keys(state[blockId])) {
            if (!(actionId in values))
                continue;
            const l = chosenLabels(state[blockId][actionId]);
            if (l !== undefined)
                out[actionId] = l;
        }
    }
    return Object.keys(out).length ? out : undefined;
}
/** Read a block_actions payload. Undefined when it has no message, user or action. */
export function clickFromAction(payload) {
    const action = payload?.actions?.[0];
    const channel = payload?.channel?.id ?? payload?.container?.channel_id;
    const ts = payload?.message?.ts ?? payload?.container?.message_ts;
    const user = payload?.user?.id;
    if (!action?.action_id || !channel || !ts || !user)
        return undefined;
    const value = action.type === "button" || action.type === "feedback_buttons" ? action.value : inputValue(action);
    const chosen = action.type === "button" || action.type === "feedback_buttons" ? undefined : chosenLabels(action);
    return {
        channel,
        ts,
        triggerId: payload.trigger_id,
        click: {
            user,
            actionId: action.action_id,
            label: action.text?.text,
            value,
            ...(chosen !== undefined ? { labels: { [action.action_id]: chosen } } : {}),
            url: !!action.url,
            elementType: action.type,
        },
    };
}
/** Read a view_submission payload. Undefined when the form isn't one of ours. */
export function clickFromSubmission(payload, opts) {
    const view = payload?.view;
    const user = payload?.user?.id;
    if (!view || view.callback_id !== opts.callbackId || !user)
        return undefined;
    let meta;
    try {
        meta = opts.unwrapMeta(view.private_metadata ?? "");
    }
    catch {
        return undefined;
    }
    const { channel, ts, formId } = meta ?? {};
    if (typeof channel !== "string" || typeof ts !== "string" || typeof formId !== "string")
        return undefined;
    const values = viewValues(view);
    const labels = viewLabels(view, values);
    return {
        channel,
        ts,
        click: { user, actionId: `form:${formId}`, ...(labels ? { labels } : {}), submit: { formId, values } },
    };
}
//# sourceMappingURL=decide.js.map