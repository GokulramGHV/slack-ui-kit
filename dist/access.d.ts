import type { Access, ControlKind, Rule } from "./types.js";
/** Looks up the Slack user ids in a user group. Throws when it can't. */
export type GroupResolver = (groupId: string) => Promise<string[]>;
type CardAccess = {
    access: Access;
    trusted: boolean;
    owner: string;
};
/**
 * The rule for one control. Closed by default: owner only. A control the
 * package couldn't classify is always owner only. Per-id rules apply only to
 * trusted cards, since on Claude-written cards Claude picks the ids.
 */
export declare function ruleFor(card: CardAccess, control: {
    id: string;
    kind: ControlKind | undefined;
}): Rule;
/**
 * Whether `user` may act under `rule`. Any failure to check a group means no.
 * `state` is the card's stored state, read by `stateUser` rules only.
 */
export declare function isAllowed(rule: Rule, user: string, owner: string, resolveGroup: GroupResolver | undefined, state?: Record<string, unknown>): Promise<boolean>;
/** The private note a refused clicker sees. */
export declare function refusalText(rule: Rule, owner: string, state?: Record<string, unknown>): string;
export {};
