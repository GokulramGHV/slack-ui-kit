import { EMPTY_CELL_TEXT } from "./blocks.js";
/** Slack's block limits: 50 in a message, 100 in a modal or Home tab. */
export const BLOCK_LIMITS = { message: 50, modal: 100 };
const isTextObject = (o) => o && typeof o === "object" && (o.type === "mrkdwn" || o.type === "plain_text");
/** True for a mrkdwn or plain_text object whose text is empty or only spaces. */
export const isEmptyText = (o) => isTextObject(o) && !String(o.text ?? "").trim();
/** Drop empty text objects (and blocks left empty), then cap at the surface's block limit. */
export function sanitize(blocks, surface = "message") {
    const out = [];
    for (const block of blocks ?? []) {
        const clean = sanitizeBlock(block);
        if (clean)
            out.push(clean);
    }
    return out.slice(0, BLOCK_LIMITS[surface]);
}
/** False for a button whose label is empty (a half-written Button("...")). Other elements pass. */
const labelled = (el) => el?.type !== "button" || !isEmptyText(el.text);
const hasLabel = (o) => !isEmptyText(o?.text);
/**
 * Drop options with empty text (a half-written Option("...")). An input left
 * with no options is dropped. Elements without options pass unchanged.
 */
function cleanOptions(el) {
    if (!Array.isArray(el?.options))
        return el;
    const e = { ...el, options: el.options.filter(hasLabel) };
    if (!e.options.length)
        return undefined;
    const values = new Set(e.options.map((o) => o.value));
    if (Array.isArray(e.initial_options)) {
        e.initial_options = e.initial_options.filter((o) => hasLabel(o) && values.has(o.value));
        if (!e.initial_options.length)
            delete e.initial_options;
    }
    if (e.initial_option && !(hasLabel(e.initial_option) && values.has(e.initial_option.value)))
        delete e.initial_option;
    return e;
}
const keepClean = (list) => (list ?? []).flatMap((b) => {
    const clean = sanitizeBlock(b);
    return clean ? [clean] : [];
});
function sanitizeBlock(block) {
    const b = { ...block };
    switch (b.type) {
        case "header":
            return isEmptyText(b.text) ? undefined : b;
        case "section":
            if (isEmptyText(b.text))
                delete b.text;
            if (Array.isArray(b.fields)) {
                b.fields = b.fields.filter((f) => !isEmptyText(f));
                if (!b.fields.length)
                    delete b.fields;
            }
            if (b.accessory) {
                const accessory = labelled(b.accessory) ? cleanOptions(b.accessory) : undefined;
                if (accessory)
                    b.accessory = accessory;
                else
                    delete b.accessory;
            }
            return b.text || b.fields || b.accessory ? b : undefined;
        case "input": {
            const element = cleanOptions(b.element);
            return element ? { ...b, element } : undefined;
        }
        case "context":
            b.elements = (b.elements ?? []).filter((e) => !isEmptyText(e));
            return b.elements.length ? b : undefined;
        case "actions":
            b.elements = (b.elements ?? []).filter(labelled).flatMap((el) => cleanOptions(el) ?? []);
            return b.elements.length ? b : undefined;
        case "card":
            if (isEmptyText(b.title))
                return undefined;
            if (isEmptyText(b.body))
                delete b.body;
            if (Array.isArray(b.actions)) {
                b.actions = b.actions.filter(labelled);
                if (!b.actions.length)
                    delete b.actions;
            }
            return b;
        case "data_table":
            b.rows = (b.rows ?? []).map((row) => (row ?? []).map((c) => (c?.type === "action_cell" && !labelled(c.element) ? { type: "raw_text", text: EMPTY_CELL_TEXT } : c)));
            return b;
        case "carousel":
            b.elements = keepClean(b.elements);
            return b.elements.length ? b : undefined;
        case "container":
            b.child_blocks = keepClean(b.child_blocks);
            return b.child_blocks.length ? b : undefined;
        case "layout":
            b.rows = (b.rows ?? [])
                .map((r) => ({
                ...r,
                items: (r.items ?? []).flatMap((it) => {
                    const block = it?.block && sanitizeBlock(it.block);
                    return block ? [{ ...it, block }] : [];
                }),
            }))
                .filter((r) => r.items.length);
            return b.rows.length ? b : undefined;
        default:
            return b;
    }
}
//# sourceMappingURL=sanitize.js.map