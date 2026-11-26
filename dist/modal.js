import { buildModal } from "@openuidev/channels/slack";
import { blocks } from "./blocks.js";
import { decodePlainText, sanitize } from "./sanitize.js";
/** A Select or MultiSelect with no options: OpenUI would swap in a text box, so it is left out. */
const noOptions = (f) => (f.kind === "select" || f.kind === "multiselect") && !(f.options ?? []).length;
/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, fields named in `optional` marked optional,
 * dropdowns with no options left out, cleaned and capped for a modal.
 */
export function formModal(spec, privateMetadata, callbackId) {
    const all = (spec.fields ?? []);
    const kept = all.filter((f) => !noOptions(f));
    // A notice sits before a field index; count only the fields that stay before it.
    const notices = (spec.notices ?? []).map((n) => ({
        ...n,
        before: all.slice(0, n.before).filter((f) => !noOptions(f)).length,
    }));
    const view = decodePlainText(buildModal({ ...spec, fields: kept }, privateMetadata));
    view.callback_id = callbackId;
    const optional = new Set(spec.optional ?? []);
    if (optional.size) {
        view.blocks = view.blocks.map((b) => (b?.type === "input" && optional.has(String(b.block_id ?? "").replace(/^\$/, "")) ? { ...b, optional: true } : b));
    }
    if (notices.length) {
        const inputs = view.blocks;
        const at = (i) => notices.filter((n) => n.before === i).map((n) => blocks.alert(n.text, n.level));
        view.blocks = [...inputs.flatMap((b, i) => [...at(i), b]), ...notices.filter((n) => n.before >= inputs.length).map((n) => blocks.alert(n.text, n.level))];
    }
    view.blocks = sanitize(view.blocks, "modal");
    return view;
}
//# sourceMappingURL=modal.js.map