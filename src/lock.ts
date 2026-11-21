import type { Block } from "./sanitize.js";
import type { LockInfo } from "./types.js";

const plain = (o: any): string | undefined => (typeof o?.text === "string" ? o.text : undefined);
const md = (text: string) => ({ type: "mrkdwn", text });

/** What an input currently shows as chosen, as mrkdwn. Undefined if it isn't an input. */
function chosen(el: Record<string, any>): string | undefined {
  const optionText = (o: any) => plain(o?.text) ?? o?.value ?? "";
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
      return el.initial_value ?? "";
    default:
      return undefined;
  }
}

const line = (label: string | undefined, value: string) => `*${label || "Chosen"}:* ${value || "none"}`;

/** Slack date token, so each reader sees their own local time. */
export function dateToken(iso: string): string {
  const d = new Date(iso);
  const unix = Math.floor(d.getTime() / 1000);
  const fallback = `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `<!date^${unix}^{date_short_pretty} at {time}|${fallback}>`;
}

/**
 * A card frozen after a submit-style click: buttons and inputs are replaced
 * with what was chosen, link buttons and feedback buttons stay, and a footer
 * says who did it and when.
 */
export function lockedBlocks(blocks: readonly Block[], lock: LockInfo, opts: { note?: string } = {}): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.type === "actions") {
      const keep: Block[] = [];
      const lines: string[] = [];
      for (const el of block.elements ?? []) {
        if (el.type === "button" && el.url) keep.push(el);
        else {
          const value = chosen(el);
          if (value !== undefined) lines.push(line(plain(el.placeholder), value));
        }
      }
      if (keep.length) out.push({ ...block, elements: keep });
      if (lines.length) out.push({ type: "section", text: md(lines.join("\n")) });
    } else if (block.type === "input") {
      const value = chosen(block.element ?? {});
      if (value !== undefined) out.push({ type: "section", text: md(line(plain(block.label), value)) });
    } else if (block.type === "section" && block.accessory && !(block.accessory.type === "button" && block.accessory.url) && block.accessory.action_id) {
      const { accessory, ...rest } = block;
      out.push(rest);
      const value = chosen(accessory);
      if (value !== undefined) out.push({ type: "section", text: md(line(plain(accessory.placeholder), value)) });
    } else {
      out.push(block);
    }
  }
  const what = lock.label ? `${lock.label} pressed` : "Submitted";
  out.push({ type: "context", elements: [md(`${what} by <@${lock.by}> at ${dateToken(lock.at)}`)] });
  if (opts.note) out.push({ type: "context", elements: [md(opts.note)] });
  return out;
}
