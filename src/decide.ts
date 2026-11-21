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

/** Read a block_actions payload. Undefined when it has no message, user or action. */
export function clickFromAction(payload: any): { channel: string; ts: string; triggerId?: string; click: Click } | undefined {
  const action = payload?.actions?.[0];
  const channel: string | undefined = payload?.channel?.id ?? payload?.container?.channel_id;
  const ts: string | undefined = payload?.message?.ts ?? payload?.container?.message_ts;
  const user: string | undefined = payload?.user?.id;
  if (!action?.action_id || !channel || !ts || !user) return undefined;
  const value = action.type === "button" || action.type === "feedback_buttons" ? action.value : inputValue(action);
  return {
    channel,
    ts,
    triggerId: payload.trigger_id,
    click: {
      user,
      actionId: action.action_id,
      label: action.text?.text,
      value,
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
  return { channel, ts, click: { user, actionId: `form:${formId}`, submit: { formId, values: viewValues(view) } } };
}
