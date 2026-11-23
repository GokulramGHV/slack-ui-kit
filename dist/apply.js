import { isChartPlaceholder } from "@openuidev/channels/slack";
import { controlsFromRender } from "./controls.js";
import { lockedBlocks } from "./lock.js";
import { sanitize } from "./sanitize.js";
/** The blocks written to Slack for a render: clean, without chart placeholders. */
export const blocksOf = (render) => sanitize(render.output.filter((b) => !isChartPlaceholder(b)));
/** A new card record for a freshly rendered OpenUI card. */
export function newOpenUICard(args) {
    const now = args.now ?? (() => new Date());
    return {
        channel: args.channel,
        ts: args.ts,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
        owner: args.owner,
        access: args.access ?? {},
        trusted: args.trusted ?? false,
        kind: "openui",
        source: args.source,
        text: args.render.text,
        state: args.render.state,
        blocks: blocksOf(args.render),
        controls: controlsFromRender(args.render),
        forms: args.render.forms,
        version: 1,
        ...(args.meta ? { meta: args.meta } : {}),
        ...(args.required?.length ? { required: args.required } : {}),
        createdAt: now().toISOString(),
    };
}
/** Who locked the card and when, for a click that locks. */
export const lockInfoFor = (decision, now) => ({
    by: decision.click.user,
    at: now().toISOString(),
    label: decision.click.submit ? "" : decision.click.label ?? "",
});
/**
 * Apply an allowed click to a card: run OpenUI's interaction or form submit,
 * then freeze the card if the click locks. No Slack calls. The result's
 * version is one more than the card's. OpenUI Mutation tools may run here.
 */
export async function applyDecision(card, decision, opts) {
    const now = opts.now ?? (() => new Date());
    const { click } = decision;
    let next = { ...card, version: card.version + 1 };
    if (card.kind === "openui" && decision.kind !== "feedback") {
        if (!opts.engine || card.source === undefined)
            throw new Error("An OpenUI card needs an engine and its source");
        const render = click.submit
            ? await opts.engine.submitForm(card.source, card.state, click.submit.formId, click.submit.values)
            : await opts.engine.applyInteraction(card.source, card.state, { actionId: click.actionId, value: click.value });
        next = { ...next, text: render.text, state: render.state, blocks: blocksOf(render), controls: controlsFromRender(render), forms: render.forms };
    }
    if (decision.lock) {
        const lock = opts.lock ?? lockInfoFor(decision, now);
        next = { ...next, locked: lock, blocks: sanitize(lockedBlocks(next.blocks, lock)) };
    }
    return next;
}
//# sourceMappingURL=apply.js.map