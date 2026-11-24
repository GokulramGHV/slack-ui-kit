import { buildModal } from "@openuidev/channels/slack";
import { blocks, type AlertLevel } from "./blocks.js";
import type { FormNotice } from "./components.js";
import { decodePlainText, sanitize, type Block } from "./sanitize.js";
import type { FormSpec } from "./types.js";

type Field = { target: string; kind: string; options?: unknown[] };

/** A Select or MultiSelect with no options: OpenUI would swap in a text box, so it is left out. */
const noOptions = (f: Field) => (f.kind === "select" || f.kind === "multiselect") && !(f.options ?? []).length;

/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, fields named in `optional` marked optional,
 * dropdowns with no options left out, cleaned and capped for a modal.
 */
export function formModal(spec: FormSpec, privateMetadata: string, callbackId: string): Record<string, any> {
  const all: Field[] = ((spec as any).fields ?? []) as Field[];
  const kept = all.filter((f) => !noOptions(f));
  // A notice sits before a field index; count only the fields that stay before it.
  const notices: FormNotice[] = ((spec as any).notices ?? []).map((n: FormNotice) => ({
    ...n,
    before: all.slice(0, n.before).filter((f) => !noOptions(f)).length,
  }));
  const view: Record<string, any> = decodePlainText(buildModal({ ...(spec as any), fields: kept }, privateMetadata));
  view.callback_id = callbackId;
  const optional = new Set<string>((spec as any).optional ?? []);
  if (optional.size) {
    view.blocks = (view.blocks as Block[]).map((b: any) => (b?.type === "input" && optional.has(String(b.block_id ?? "").replace(/^\$/, "")) ? { ...b, optional: true } : b));
  }
  if (notices.length) {
    const inputs: Block[] = view.blocks;
    const at = (i: number) => notices.filter((n) => n.before === i).map((n) => blocks.alert(n.text, n.level as AlertLevel));
    view.blocks = [...inputs.flatMap((b, i) => [...at(i), b]), ...notices.filter((n) => n.before >= inputs.length).map((n) => blocks.alert(n.text, n.level as AlertLevel))];
  }
  view.blocks = sanitize(view.blocks, "modal");
  return view;
}
