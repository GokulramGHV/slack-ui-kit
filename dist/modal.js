import { buildModal } from "@openuidev/channels/slack";
import { blocks } from "./blocks.js";
import { sanitize } from "./sanitize.js";
/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, cleaned and capped for a modal.
 */
export function formModal(spec, privateMetadata, callbackId) {
    const view = buildModal(spec, privateMetadata);
    view.callback_id = callbackId;
    const notices = spec.notices ?? [];
    if (notices.length) {
        const inputs = view.blocks;
        const at = (i) => notices.filter((n) => n.before === i).map((n) => blocks.alert(n.text, n.level));
        view.blocks = [...inputs.flatMap((b, i) => [...at(i), b]), ...notices.filter((n) => n.before >= inputs.length).map((n) => blocks.alert(n.text, n.level))];
    }
    view.blocks = sanitize(view.blocks, "modal");
    return view;
}
//# sourceMappingURL=modal.js.map