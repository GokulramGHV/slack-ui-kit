import type { Block } from "./sanitize.js";

/** What OpenUI 0.1.0 uses as a card's text when it finds no Header or Section. */
export const OPENUI_DEFAULT_TEXT = "OpenUI message";

const textOf = (o: any): string => (typeof o === "string" ? o : typeof o?.text === "string" ? o.text : "").trim();

function titleOf(b: Block): string {
  switch (b?.type) {
    case "header":
      return textOf(b.text);
    case "section":
      return textOf(b.text) || (b.fields ?? []).map(textOf).filter(Boolean).join(" ");
    case "plan":
    case "task_card":
      return textOf(b.title);
    case "data_table":
      return textOf(b.caption);
    case "card":
    case "container":
      return textOf(b.title);
    case "carousel":
      return (b.elements ?? []).map(titleOf).find(Boolean) ?? "";
    case "layout":
      return textOf(b.label);
    case "rich_text":
      return (b.elements ?? [])
        .flatMap((s: Block) => s.elements ?? [])
        .map((e: Block) => (e.type === "text" || e.type === "tag" ? e.text : ""))
        .join("")
        .trim();
    default:
      return "";
  }
}

/** Notification text for a card: the first readable title in its blocks. */
export function notificationText(blocks: readonly Block[]): string {
  for (const b of blocks) {
    const t = titleOf(b);
    if (t) return t.slice(0, 3000);
  }
  return "Card";
}
