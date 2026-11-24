import { inputValue, viewValues } from "@openuidev/channels/slack";
import { isAllowed, refusalText, ruleFor, type GroupResolver } from "./access.js";
import type { CardRecord, ControlKind, Rule } from "./types.js";

/** One click or form submit, read from a Slack payload. */
export type Click = {
  user: string;
  actionId: string;
  /** Button text, used in the lock footer. */
  label?: string;
  value?: unknown;
  /** Shown text of the chosen option(s), read from the Slack payload. */
  labels?: Record<string, string | string[]>;
  /** True for a link button: Slack opens the URL, nothing to do. */
  url?: boolean;
  /** The Slack element type, such as "button" or "checkboxes". */
  elementType?: string;
  /** Set for a form submit. */
  submit?: { formId: string; values: Record<string, unknown> };
};

export type Decision =
  | { type: "ignore"; click: Click; reason: "link" | "unknown-control" }
  | { type: "locked"; click: Click }
  | { type: "deny"; click: Click; kind: ControlKind; rule: Rule; message: string }
  | { type: "open-form"; click: Click; formId: string }
  | { type: "apply"; click: Click; kind: ControlKind; lock: boolean; notify: boolean };

export type DecideContext = {
  resolveGroup?: GroupResolver;
  /** "default": tell the bot about buttons, feedback and form submits. "all": inputs too. */
  events?: "default" | "all";
};

/** Whether this click freezes the card under its lock policy. */
function locks(card: CardRecord, click: Click, kind: ControlKind): boolean {
  const submitStyle = kind === "button" || (kind === "form" && !!click.submit);
  const policy = card.access.lock ?? "buttons";
  if (policy === "never") return false;
  if (policy !== "buttons" && card.trusted) return policy.ids.includes(click.actionId);
  return submitStyle; // "buttons", or an id list on an untrusted card (ignored)
}

/**
 * Decide what a click means: ignore, already locked, deny, open a form, or
 * apply. Makes no Slack calls; the only outside call is the group lookup.
 */
export async function decide(click: Click, card: CardRecord, ctx: DecideContext = {}): Promise<Decision> {
  if (click.url) return { type: "ignore", click, reason: "link" };
  const kind = card.controls[click.actionId];
  if (!kind) return { type: "ignore", click, reason: "unknown-control" };
  if (card.locked && kind !== "feedback") return { type: "locked", click };
  const rule = ruleFor(card, { id: click.actionId, kind });
  if (!(await isAllowed(rule, click.user, card.owner, ctx.resolveGroup))) {
    return { type: "deny", click, kind, rule, message: refusalText(rule, card.owner) };
  }
  if (kind === "form" && !click.submit) return { type: "open-form", click, formId: click.actionId.slice("form:".length) };
  const notify = kind !== "input" || ctx.events === "all";
  return { type: "apply", click, kind, lock: kind !== "feedback" && locks(card, click, kind), notify };
}

/**
 * The value an input element holds, as it is saved into $state. OpenUI's inputValue, plus number inputs
 * (a number, or null when cleared) and search dropdowns (items { value, label }; an array for the multi one).
 */
export function elementValue(action: any): unknown {
  switch (action?.type) {
    case "number_input": {
      const v = action.value;
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "external_select": {
      const o = action.selected_option;
      return o ? { value: o.value, label: o.text?.text ?? o.value } : null;
    }
    case "multi_external_select":
      return (action.selected_options ?? []).map((o: any) => ({ value: o.value, label: o.text?.text ?? o.value }));
    default:
      return inputValue(action);
  }
}

/** Shown text of the options an input element has chosen. Undefined when it has none. */
function chosenLabels(el: any): string | string[] | undefined {
  const text = (o: any): string | undefined => (typeof o?.text?.text === "string" ? o.text.text : undefined);
  switch (el?.type) {
    case "static_select":
    case "external_select":
    case "radio_buttons":
    case "overflow":
      return text(el.selected_option);
    case "multi_static_select":
    case "multi_external_select":
    case "checkboxes": {
      const all = (el.selected_options ?? []).map(text).filter((t: string | undefined): t is string => t !== undefined);
      return all.length ? all : undefined;
    }
    default:
      return undefined;
  }
}

/** Labels for the fields of a submitted modal, keyed like the submit values. Undefined when none. */
function viewLabels(view: any, values: Record<string, unknown>): Record<string, string | string[]> | undefined {
  const out: Record<string, string | string[]> = {};
  const state = view?.state?.values ?? {};
  for (const blockId of Object.keys(state)) {
    for (const actionId of Object.keys(state[blockId])) {
      if (!(actionId in values)) continue;
      const l = chosenLabels(state[blockId][actionId]);
      if (l !== undefined) out[actionId] = l;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Read a block_actions payload. Undefined when it has no message, user or action. */
export function clickFromAction(payload: any): { channel: string; ts: string; triggerId?: string; click: Click } | undefined {
  const action = payload?.actions?.[0];
  const channel: string | undefined = payload?.channel?.id ?? payload?.container?.channel_id;
  const ts: string | undefined = payload?.message?.ts ?? payload?.container?.message_ts;
  const user: string | undefined = payload?.user?.id;
  if (!action?.action_id || !channel || !ts || !user) return undefined;
  const value = action.type === "button" || action.type === "feedback_buttons" ? action.value : elementValue(action);
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

export type FormMetaOptions = {
  /** The callback id on forms this package opens. */
  callbackId: string;
  /** Read the form's hidden data back. Throwing means "not ours". */
  unwrapMeta: (privateMetadata: string) => any;
};

/** Read a view_submission payload. Undefined when the form isn't one of ours. */
export function clickFromSubmission(
  payload: any,
  opts: FormMetaOptions,
): { channel: string; ts: string; click: Click } | undefined {
  const view = payload?.view;
  const user: string | undefined = payload?.user?.id;
  if (!view || view.callback_id !== opts.callbackId || !user) return undefined;
  let meta: any;
  try {
    meta = opts.unwrapMeta(view.private_metadata ?? "");
  } catch {
    return undefined;
  }
  const { channel, ts, formId } = meta ?? {};
  if (typeof channel !== "string" || typeof ts !== "string" || typeof formId !== "string") return undefined;
  const values = viewValues(view);
  const labels = viewLabels(view, values);
  return {
    channel,
    ts,
    click: { user, actionId: `form:${formId}`, ...(labels ? { labels } : {}), submit: { formId, values } },
  };
}
