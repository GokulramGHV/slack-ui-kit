import type { RenderResult } from "@openuidev/channels";
import type { Block } from "./sanitize.js";
/** An OpenUI form spec, saved so a form opens without rendering again. */
export type FormSpec = RenderResult<unknown>["forms"][string];
/**
 * Who may use a control. `stateUser` names a key in the card's state ($state
 * variable, with or without the dollar sign); only the Slack user whose id is
 * that value may act, and nobody may when it is missing or not a user id.
 */
export type Rule = "owner" | "anyone" | {
    group: string;
} | {
    users: string[];
} | {
    stateUser: string;
};
/** What kind of control a click came from. Read from the render, never from names Claude picks. */
export type ControlKind = "button" | "input" | "feedback" | "form";
/**
 * Who may use a card's controls, and when it locks.
 * A control with no matching rule is owner only.
 */
export type Access = {
    /** Rule for any control without a more specific one. Missing means "owner". */
    default?: Rule;
    buttons?: Rule;
    inputs?: Rule;
    /** Thumbs up and down. Missing means "anyone". */
    feedback?: Rule;
    /** Opening a form and submitting it. */
    forms?: Rule;
    /** Per-control rules by action id. Only honoured on trusted cards. */
    byId?: Record<string, Rule>;
    /**
     * Which clicks freeze the card. "buttons": any button that runs an action
     * (the default). Ids are only honoured on trusted cards.
     */
    lock?: "buttons" | "never" | {
        ids: string[];
    };
};
/** Who locked a card, when (ISO time), and with which control label. */
export type LockInfo = {
    by: string;
    at: string;
    label: string;
    /** Set when the host closed the card (closeCard) instead of a click locking it. */
    note?: string;
    /** An extra footer line below "pressed by", kept when the card is redrawn (set when the click's own work failed). */
    afterNote?: string;
};
/** Everything stored for one card. (channel, ts) is the key; the card id is `channel:ts`. */
export type CardRecord = {
    channel: string;
    ts: string;
    threadTs?: string;
    owner: string;
    access: Access;
    /** True when the host wrote the source or blocks (templates), so ids can carry rules. */
    trusted: boolean;
    /** "openui": rendered from OpenUI Lang. "blocks": raw blocks the host posted. */
    kind: "openui" | "blocks";
    source?: string;
    state: Record<string, unknown>;
    /** Notification fallback text for the message. */
    text: string;
    /** The last blocks written to the message; used to undo a refused click. */
    blocks: Block[];
    /** action id -> control kind, from the last render. Clicks on ids not here are ignored. */
    controls: Record<string, ControlKind>;
    /** form id -> spec, from the last render. */
    forms: Record<string, FormSpec>;
    locked?: LockInfo;
    /** True from the moment a click claims the lock until its result is saved; updateCard waits for it. */
    finishing?: true;
    /**
     * Groups of $state variable names (without `$`). A click that would lock the card is
     * refused until every group has at least one non-empty variable.
     */
    required?: string[][];
    /** Save counter for the version check. Not the template version (that goes in meta). */
    version: number;
    meta?: Record<string, unknown>;
    createdAt: string;
};
/**
 * Where cards are kept. `put` must be atomic: save only if the stored version
 * still equals `expectedVersion` (null: only if no card is stored yet).
 * In SQL: UPDATE ... WHERE channel = ? AND ts = ? AND version = ?.
 */
export interface CardStore {
    get(channel: string, ts: string): Promise<CardRecord | undefined>;
    put(card: CardRecord, expectedVersion: number | null): Promise<boolean>;
}
/** What the bot is told after an allowed click or form submit. */
export type CardEvent = {
    type: "action" | "submit";
    card: {
        channel: string;
        ts: string;
        threadTs?: string;
    };
    /** Slack user id of who clicked. */
    user: string;
    control: {
        id: string;
        kind: ControlKind;
        label?: string;
        value?: unknown;
        /**
         * Shown text of the chosen option(s), read from the Slack payload. For a submit, one entry per
         * choice field, keyed like `value`; for an input click, `{ [id]: text }`. Absent for buttons and
         * when nothing is chosen.
         */
        labels?: Record<string, string | string[]>;
    };
    /** The card's $state after the click. */
    state: Record<string, unknown>;
    /**
     * Shown option text for each $state variable bound to a choice input (radio, checkboxes, select,
     * multi select, overflow), for its value after the click. Keyed like `state`. Values that match no
     * option are left out; absent when empty and on raw-block cards.
     */
    stateLabels?: Record<string, string | string[]>;
    locked?: LockInfo;
    meta?: Record<string, unknown>;
    /** Set when the click was committed but the card's own update failed afterwards. */
    error?: string;
};
