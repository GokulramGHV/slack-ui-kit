/**
 * Make blocks safe to send. Slack rejects a whole message (invalid_blocks)
 * when any text object has empty text, and OpenUI 0.1.0 passes those through,
 * e.g. Section($note) while $note is still "".
 */
export type Block = Record<string, any>;
export type Surface = "message" | "modal";

/** Slack's block limits: 50 in a message, 100 in a modal or Home tab. */
export const BLOCK_LIMITS: Record<Surface, number> = { message: 50, modal: 100 };

const isTextObject = (o: any) => o && typeof o === "object" && (o.type === "mrkdwn" || o.type === "plain_text");

/** True for a mrkdwn or plain_text object whose text is empty or only spaces. */
export const isEmptyText = (o: any): boolean => isTextObject(o) && !String(o.text ?? "").trim();

/** Drop empty text objects (and blocks left empty), then cap at the surface's block limit. */
export function sanitize(blocks: readonly Block[], surface: Surface = "message"): Block[] {
  const out: Block[] = [];
  for (const block of blocks ?? []) {
    const clean = sanitizeBlock(block);
    if (clean) out.push(clean);
  }
  return out.slice(0, BLOCK_LIMITS[surface]);
}

function sanitizeBlock(block: Block): Block | undefined {
  const b: Block = { ...block };
  switch (b.type) {
    case "header":
      return isEmptyText(b.text) ? undefined : b;
    case "section":
      if (isEmptyText(b.text)) delete b.text;
      if (Array.isArray(b.fields)) {
        b.fields = b.fields.filter((f: any) => !isEmptyText(f));
        if (!b.fields.length) delete b.fields;
      }
      return b.text || b.fields || b.accessory ? b : undefined;
    case "context":
      b.elements = (b.elements ?? []).filter((e: any) => !isEmptyText(e));
      return b.elements.length ? b : undefined;
    default:
      return b;
  }
}
