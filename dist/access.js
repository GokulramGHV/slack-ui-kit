/**
 * The rule for one control. Closed by default: owner only. A control the
 * package couldn't classify is always owner only. Per-id rules apply only to
 * trusted cards, since on Claude-written cards Claude picks the ids.
 */
export function ruleFor(card, control) {
    const { access, trusted } = card;
    if (!control.kind)
        return "owner";
    const byId = trusted ? access.byId?.[control.id] : undefined;
    if (byId)
        return byId;
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
/** Whether `user` may act under `rule`. Any failure to check a group means no. */
export async function isAllowed(rule, user, owner, resolveGroup) {
    if (rule === "anyone")
        return true;
    if (rule === "owner")
        return user === owner;
    if ("users" in rule)
        return rule.users.includes(user);
    if (!resolveGroup)
        return false;
    try {
        return (await resolveGroup(rule.group)).includes(user);
    }
    catch {
        return false;
    }
}
/** The private note a refused clicker sees. */
export function refusalText(rule, owner) {
    if (rule === "owner" || rule === "anyone")
        return `Only <@${owner}> can do this.`;
    if ("group" in rule)
        return `Only people in <!subteam^${rule.group}> can do this.`;
    const names = rule.users.map((u) => `<@${u}>`);
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0] ?? "certain people";
    return `Only ${who} can do this.`;
}
//# sourceMappingURL=access.js.map