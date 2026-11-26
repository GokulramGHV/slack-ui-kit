import type { Access, ControlKind, Rule } from "./types.js";

/** Looks up the Slack user ids in a user group. Throws when it can't. */
export type GroupResolver = (groupId: string) => Promise<string[]>;

type CardAccess = { access: Access; trusted: boolean; owner: string };

/**
 * The rule for one control. Closed by default: owner only. A control the
 * package couldn't classify is always owner only. Per-id rules apply only to
 * trusted cards, since on Claude-written cards Claude picks the ids.
 */
export function ruleFor(card: CardAccess, control: { id: string; kind: ControlKind | undefined }): Rule {
  const { access, trusted } = card;
  if (!control.kind) return "owner";
  const byId = trusted ? access.byId?.[control.id] : undefined;
  if (byId) return byId;
  switch (control.kind) {
    case "feedback":
      return access.feedback ?? "anyone";
    case "button":
      return access.buttons ?? access.default ?? "owner";
    case "input":
      return access.inputs ?? access.default ?? "owner";
    case "form":
      return access.forms ?? access.default ?? "owner";
  }
}

const USER_ID = /^[UW][A-Z0-9]{2,}$/;

/**
 * The Slack user id a `stateUser` rule names: the card's state value for that key
 * (stored with a dollar sign; the rule may name it with or without). Undefined
 * unless it is a well-formed user id, so a missing or odd value allows nobody.
 */
function stateUserId(key: string, state: Record<string, unknown> | undefined): string | undefined {
  const v = state?.[key.startsWith("$") ? key : "$" + key];
  return typeof v === "string" && USER_ID.test(v) ? v : undefined;
}

/**
 * Whether `user` may act under `rule`. Any failure to check a group means no.
 * `state` is the card's stored state, read by `stateUser` rules only.
 */
export async function isAllowed(
  rule: Rule,
  user: string,
  owner: string,
  resolveGroup: GroupResolver | undefined,
  state?: Record<string, unknown>,
): Promise<boolean> {
  if (rule === "anyone") return true;
  if (rule === "owner") return user === owner;
  if ("users" in rule) return rule.users.includes(user);
  if ("stateUser" in rule) return stateUserId(rule.stateUser, state) === user;
  if (!resolveGroup) return false;
  try {
    return (await resolveGroup(rule.group)).includes(user);
  } catch {
    return false;
  }
}

/** The private note a refused clicker sees. */
export function refusalText(rule: Rule, owner: string, state?: Record<string, unknown>): string {
  if (rule === "owner" || rule === "anyone") return `Only <@${owner}> can do this.`;
  if ("stateUser" in rule) {
    const id = stateUserId(rule.stateUser, state);
    return id ? `Only <@${id}> can do this.` : "Nobody can do this yet.";
  }
  if ("group" in rule) return `Only people in <!subteam^${rule.group}> can do this.`;
  const names = rule.users.map((u) => `<@${u}>`);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0] ?? "certain people";
  return `Only ${who} can do this.`;
}
