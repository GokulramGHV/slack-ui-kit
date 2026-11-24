import type { SlackTools } from "@openuidev/channels/slack";
import type { GroupResolver } from "./access.js";
import { type Decision } from "./decide.js";
import { type CardEngine } from "./openui/engine.js";
import { type ComponentChanges, type SlackLibrary } from "./openui/library.js";
import { type Block } from "./sanitize.js";
import type { Access, CardEvent, CardRecord, CardStore } from "./types.js";
/** The Slack methods the kit uses. A Bolt client or @slack/web-api WebClient fits. */
export type SlackClient = {
    chat: {
        postMessage(args: any): Promise<any>;
        update(args: any): Promise<any>;
        delete(args: any): Promise<any>;
        postEphemeral(args: any): Promise<any>;
    };
    views: {
        open(args: any): Promise<any>;
    };
    usergroups?: {
        users: {
            list(args: {
                usergroup: string;
            }): Promise<{
                users?: string[];
            }>;
        };
    };
};
/** What the kit puts in a form's hidden data. */
export type FormMeta = {
    channel: string;
    ts: string;
    formId: string;
};
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
export type SearchOption = {
    value: string;
    label: string;
};
/** What Slack expects back for a block_suggestion: at most 100 options. */
export type OptionsResponse = {
    options: Array<{
        text: {
            type: "plain_text";
            text: string;
        };
        value: string;
    }>;
};
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
declare const DEFAULT_MESSAGES: {
    alreadySubmitted: string;
    busy: string;
    failedAfterLock: string;
    answerFirst: string;
};
export type PostTarget = {
    channel: string;
    threadTs?: string;
};
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
export type ActionResult = {
    handled: false;
} | {
    handled: true;
    decision?: Decision;
    card?: CardRecord;
    event?: CardEvent;
    /** Set when the card was saved but writing it to Slack failed. */
    updateError?: unknown;
};
export type SubmissionResult = {
    handled: false;
} | {
    handled: true;
    decision?: Decision;
    /** Return this to Slack as the view_submission reply (undefined: close the form). */
    response?: {
        response_action: "errors";
        errors: Record<string, string>;
    };
    /** The rest of the work; await it after replying to Slack. */
    done: Promise<ActionResult>;
};
/** onEvent threw. The click is already saved, so the event is attached for the host to retry. */
export declare class EventDeliveryError extends Error {
    readonly event: CardEvent;
    readonly card: CardRecord;
    constructor(event: CardEvent, card: CardRecord, cause: unknown);
}
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
    postCard(client: SlackClient, target: PostTarget, source: string | AsyncIterable<string>, post: PostOptions): Promise<{
        card: CardRecord;
        ts: string;
        source: string;
    }>;
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
    closeCard(client: SlackClient, channel: string, ts: string, opts: {
        note: string;
    }): Promise<boolean>;
    handleAction(client: SlackClient, payload: unknown): Promise<ActionResult>;
    handleViewSubmission(client: SlackClient, payload: unknown): Promise<SubmissionResult>;
    /**
     * Answer Slack's block_suggestion payload (a user typing in a SearchSelect) with the JSON Slack
     * expects. Never throws: a refused user, an unknown card, a missing or failing loadOptions all give
     * no options. Pass the client so a user group rule can be checked.
     */
    handleOptions(payload: unknown, client?: SlackClient): Promise<OptionsResponse>;
};
export declare function createSlackKit(opts?: SlackKitOptions): SlackKit;
export {};
