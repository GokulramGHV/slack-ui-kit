import type { Block } from "./sanitize.js";
import type { LockInfo } from "./types.js";

const plain = (o: any): string | undefined => (typeof o?.text === "string" ? o.text : undefined);
const md = (text: string) => ({ type: "mrkdwn", text });
/** Option text, typed text and labels are plain text; escape them before they go into mrkdwn. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What an input currently shows as chosen, as mrkdwn. Undefined if it isn't an input. */
function chosen(el: Record<string, any>): string | undefined {
  const optionText = (o: any) => esc(String(plain(o?.text) ?? o?.value ?? ""));
  switch (el.type) {
    case "checkboxes":
    case "multi_static_select":
    case "multi_external_select":
      return (el.initial_options ?? []).map(optionText).join(", ");
    case "static_select":
    case "external_select":
    case "radio_buttons":
    case "overflow":
      return el.initial_option ? optionText(el.initial_option) : "";
    case "datepicker":
      return el.initial_date ?? "";
    case "timepicker":
      return el.initial_time ?? "";
    case "datetimepicker":
      return el.initial_date_time ? `<!date^${el.initial_date_time}^{date_short_pretty} at {time}|${el.initial_date_time}>` : "";
    case "users_select":
      return el.initial_user ? `<@${el.initial_user}>` : "";
    case "multi_users_select":
      return (el.initial_users ?? []).map((u: string) => `<@${u}>`).join(", ");
    case "channels_select":
      return el.initial_channel ? `<#${el.initial_channel}>` : "";
    case "multi_channels_select":
      return (el.initial_channels ?? []).map((c: string) => `<#${c}>`).join(", ");
    case "conversations_select":
      return el.initial_conversation ? `<#${el.initial_conversation}>` : "";
    case "multi_conversations_select":
      return (el.initial_conversations ?? []).map((c: string) => `<#${c}>`).join(", ");
    case "plain_text_input":
    case "number_input":
    case "email_text_input":
    case "url_text_input":
      return esc(String(el.initial_value ?? ""));
    default:
      return undefined;
  }
}

const line = (label: string | undefined, value: string) => `*${label ? esc(label) : "Chosen"}:* ${value || "none"}`;

/** Slack date token, so each reader sees their own local time. */
export function dateToken(iso: string): string {
  const d = new Date(iso);
  const unix = Math.floor(d.getTime() / 1000);
  const fallback = `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `<!date^${unix}^{date_short_pretty} at {time}|${fallback}>`;
}

const label = (el: any) => plain(el?.text) ?? "";
const isLink = (el: any) => el?.type === "button" && !!el.url;

/** One block with its live controls replaced. May return zero, one or two blocks. */
function freezeBlock(block: Block): Block[] {
  switch (block.type) {
    case "actions": {
      const keep: Block[] = [];
      const lines: string[] = [];
      for (const el of block.elements ?? []) {
        if (isLink(el)) keep.push(el);
        else {
          const value = chosen(el);
          if (value !== undefined) lines.push(line(plain(el.placeholder), value));
        }
      }
      return [...(keep.length ? [{ ...block, elements: keep }] : []), ...(lines.length ? [{ type: "section", text: md(lines.join("\n")) }] : [])];
    }
    case "input": {
      const value = chosen(block.element ?? {});
      return value !== undefined ? [{ type: "section", text: md(line(plain(block.label), value)) }] : [];
    }
    case "section": {
      if (!block.accessory?.action_id || isLink(block.accessory)) return [block];
      const { accessory, ...rest } = block;
      const value = chosen(accessory);
      return [rest, ...(value !== undefined ? [{ type: "section", text: md(line(plain(accessory.placeholder), value)) }] : [])];
    }
    case "card": {
      const { actions, ...rest } = block;
      const links = (actions ?? []).filter(isLink);
      return [links.length ? { ...rest, actions: links } : rest];
    }
    case "carousel":
      return [{ ...block, elements: (block.elements ?? []).flatMap(freezeBlock) }];
    case "container":
      return [{ ...block, child_blocks: freeze(block.child_blocks ?? []) }];
    case "layout":
      // A layout item holds one block, so keep the frozen block itself and drop any "chosen" line.
      return [
        {
          ...block,
          rows: (block.rows ?? []).map((r: Block) => ({
            ...r,
            items: (r.items ?? []).flatMap((it: Block) => {
              const [first] = freezeBlock(it.block ?? {});
              return first ? [{ ...it, block: first }] : [];
            }),
          })),
        },
      ];
    case "data_table":
      return [
        {
          ...block,
          rows: (block.rows ?? []).map((row: Block[]) =>
            row.map((c) => (c?.type === "action_cell" && !isLink(c.element) ? { type: "raw_text", text: label(c.element) } : c)),
          ),
        },
      ];
    default:
      return [block];
  }
}

/** Blocks with every live control replaced by what was chosen. Link buttons and feedback stay. */
export function freeze(blocks: readonly Block[]): Block[] {
  return blocks.flatMap(freezeBlock);
}

/**
 * A card frozen after a submit-style click: buttons and inputs are replaced
 * with what was chosen, link buttons and feedback buttons stay, and a footer
 * says who did it and when.
 */
export function lockedBlocks(blocks: readonly Block[], lock: LockInfo, opts: { note?: string } = {}): Block[] {
  const out = freeze(blocks);
  const what = lock.label ? `${lock.label} pressed` : "Submitted";
  out.push({ type: "context", elements: [md(`${what} by <@${lock.by}> at ${dateToken(lock.at)}`)] });
  if (opts.note) out.push({ type: "context", elements: [md(opts.note)] });
  return out;
}
