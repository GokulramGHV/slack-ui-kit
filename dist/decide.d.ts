import { type GroupResolver } from "./access.js";
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
    submit?: {
        formId: string;
        values: Record<string, unknown>;
    };
};
export type Decision = {
    type: "ignore";
    click: Click;
    reason: "link" | "unknown-control";
} | {
    type: "locked";
    click: Click;
} | {
    type: "deny";
    click: Click;
    kind: ControlKind;
    rule: Rule;
    message: string;
} | {
    type: "open-form";
    click: Click;
    formId: string;
} | {
    type: "apply";
    click: Click;
    kind: ControlKind;
    lock: boolean;
    notify: boolean;
};
export type DecideContext = {
    resolveGroup?: GroupResolver;
    /** "default": tell the bot about buttons, feedback and form submits. "all": inputs too. */
    events?: "default" | "all";
};
/**
 * Decide what a click means: ignore, already locked, deny, open a form, or
 * apply. Makes no Slack calls; the only outside call is the group lookup.
 */
export declare function decide(click: Click, card: CardRecord, ctx?: DecideContext): Promise<Decision>;
/** Read a block_actions payload. Undefined when it has no message, user or action. */
export declare function clickFromAction(payload: any): {
    channel: string;
    ts: string;
    triggerId?: string;
    click: Click;
} | undefined;
export type FormMetaOptions = {
    /** The callback id on forms this package opens. */
    callbackId: string;
    /** Read the form's hidden data back. Throwing means "not ours". */
    unwrapMeta: (privateMetadata: string) => any;
};
/** Read a view_submission payload. Undefined when the form isn't one of ours. */
export declare function clickFromSubmission(payload: any, opts: FormMetaOptions): {
    channel: string;
    ts: string;
    click: Click;
} | undefined;
