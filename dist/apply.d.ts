import type { Decision } from "./decide.js";
import type { CardEngine, Render } from "./openui/engine.js";
import { type Block } from "./sanitize.js";
import type { Access, CardRecord, LockInfo } from "./types.js";
type Now = () => Date;
/** The blocks written to Slack for a render: clean, without chart placeholders. */
export declare const blocksOf: (render: Render) => Block[];
/** A new card record for a freshly rendered OpenUI card. */
export declare function newOpenUICard(args: {
    channel: string;
    ts: string;
    threadTs?: string;
    owner: string;
    source: string;
    render: Render;
    access?: Access;
    trusted?: boolean;
    meta?: Record<string, unknown>;
    required?: string[][];
    now?: Now;
}): CardRecord;
/** Who locked the card and when, for a click that locks. */
export declare const lockInfoFor: (decision: Extract<Decision, {
    type: "apply";
}>, now: Now) => LockInfo;
/**
 * Apply an allowed click to a card: run OpenUI's interaction or form submit,
 * then freeze the card if the click locks. No Slack calls. The result's
 * version is one more than the card's. OpenUI Mutation tools may run here.
 */
export declare function applyDecision(card: CardRecord, decision: Extract<Decision, {
    type: "apply";
}>, opts: {
    engine?: CardEngine;
    now?: Now;
    lock?: LockInfo;
}): Promise<CardRecord>;
export {};
