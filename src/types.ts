import type { Block } from "./sanitize.js";

/** Who may use a control. */
export type Rule = "owner" | "anyone" | { group: string } | { users: string[] };

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
  lock?: "buttons" | "never" | { ids: string[] };
};

/** Who locked a card, when (ISO time), and with which control label. */
export type LockInfo = { by: string; at: string; label: string };

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
  /** The last blocks written to the message; used to undo a refused click. */
  blocks: Block[];
  locked?: LockInfo;
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
  card: { channel: string; ts: string; threadTs?: string };
  /** Slack user id of who clicked. */
  user: string;
  control: { id: string; kind: ControlKind; label?: string; value?: unknown };
  /** The card's $state after the click. */
  state: Record<string, unknown>;
  locked?: LockInfo;
  meta?: Record<string, unknown>;
};
