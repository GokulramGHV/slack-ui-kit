import { buildModal } from "@openuidev/channels/slack";
import { blocks, type AlertLevel } from "./blocks.js";
import type { FormNotice } from "./components.js";
import { decodePlainText, sanitize, type Block } from "./sanitize.js";
import type { FormSpec } from "./types.js";

/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, cleaned and capped for a modal.
 */
export function formModal(spec: FormSpec, privateMetadata: string, callbackId: string): Record<string, any> {
  const view: Record<string, any> = decodePlainText(buildModal(spec as any, privateMetadata));
  view.callback_id = callbackId;
  const notices: FormNotice[] = (spec as any).notices ?? [];
  if (notices.length) {
    const inputs: Block[] = view.blocks;
    const at = (i: number) => notices.filter((n) => n.before === i).map((n) => blocks.alert(n.text, n.level as AlertLevel));
    view.blocks = [...inputs.flatMap((b, i) => [...at(i), b]), ...notices.filter((n) => n.before >= inputs.length).map((n) => blocks.alert(n.text, n.level as AlertLevel))];
  }
  view.blocks = sanitize(view.blocks, "modal");
  return view;
}
