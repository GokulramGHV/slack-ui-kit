/**
 * Plain Block Kit builders for the newer Slack blocks. Host code can use these
 * directly (progress messages, templates) and the OpenUI components call them.
 * Shapes follow what Slack accepted in a live test on 2026-11-22.
 */
import type { Block } from "./sanitize.js";

export type TaskStatus = "pending" | "in_progress" | "complete" | "error";
export type Source = { label: string; url: string };
export type TaskInput = {
  /** Slack's task_id. Defaults to t1, t2, ... in a plan. */
  id?: string;
  title: string;
  status: TaskStatus;
  /** Shown when the task is opened. Mentions (<@U1>) and date tokens become rich text. */
  details?: string;
  output?: string;
  sources?: Source[];
};

export type Align = "left" | "center" | "right";
/** A table cell: text, a number, or (data tables only) a Slack button element. */
export type Cell = string | number | Block;

export const LIMITS = {
  planTasks: 50,
  tableRows: 100,
  tableColumns: 20,
  dataTableRows: 200,
  dataTableColumns: 20,
  dataTableChars: 20_000,
} as const;

const STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "complete", "error"]);
const filled = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

const TOKEN = /(<@[A-Z0-9]+>|<!date\^\d+\^[^|>]+\|[^>]*>)/;

/** One rich_text block from a line of text. Mentions and Slack date tokens become their own elements. */
export function richText(text: string): Block {
  const elements = String(text)
    .split(TOKEN)
    .filter(Boolean)
    .map((part) => {
      const user = part.match(/^<@([A-Z0-9]+)>$/);
      if (user) return { type: "user", user_id: user[1] };
      const date = part.match(/^<!date\^(\d+)\^([^|>]+)\|([^>]*)>$/);
      if (date) return { type: "date", timestamp: Number(date[1]), format: date[2], fallback: date[3] };
      return { type: "text", text: part };
    });
  return { type: "rich_text", elements: [{ type: "rich_text_section", elements }] };
}

function taskCard(task: TaskInput, index = 0): Block {
  const sources = (task.sources ?? []).filter((s) => filled(s?.url)).map((s) => ({ type: "url", url: s.url, text: filled(s.label) ? s.label : s.url }));
  return {
    type: "task_card",
    task_id: filled(task.id) ? task.id : `t${index + 1}`,
    title: String(task.title ?? ""),
    status: STATUSES.has(task.status) ? task.status : "pending",
    ...(filled(task.details) ? { details: richText(task.details) } : {}),
    ...(filled(task.output) ? { output: richText(task.output) } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

function plan(title: string, tasks: readonly TaskInput[]): Block {
  return { type: "plan", title: String(title ?? ""), tasks: tasks.slice(0, LIMITS.planTasks).map((t, i) => taskCard(t, i)) };
}

const ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right"]);
const rawText = (text: string) => ({ type: "raw_text", text });
const boldText = (text: string) => ({
  type: "rich_text",
  elements: [{ type: "rich_text_section", elements: [{ type: "text", text, style: { bold: true } }] }],
});

function cell(c: Cell): Block {
  if (typeof c === "number") return { type: "raw_number", value: c, text: String(c) };
  if (c && typeof c === "object") return c.type === "button" ? { type: "action_cell", element: c } : c;
  return rawText(c == null ? "" : String(c));
}

const cellChars = (c: Block): number => String(c.text ?? c.element?.text?.text ?? "").length;

/**
 * Slack's table block. Matches OpenUI's own Table (bold header row, text
 * cells), and adds number cells and per-column alignment.
 */
function table(headers: readonly string[], rows: readonly (readonly Cell[])[], opts: { align?: readonly Align[] } = {}): Block {
  const cols = LIMITS.tableColumns;
  const out: Block[][] = [];
  if (headers.length) out.push(headers.slice(0, cols).map((h) => boldText(String(h ?? ""))));
  for (const r of rows.slice(0, headers.length ? LIMITS.tableRows - 1 : LIMITS.tableRows)) {
    out.push((Array.isArray(r) ? r : []).slice(0, cols).map((c) => cell(typeof c === "object" && c ? "" : c)));
  }
  const align = opts.align?.length ? { column_settings: opts.align.slice(0, cols).map((a) => ({ align: ALIGNS.has(a) ? a : "left" })) } : {};
  return { type: "table", ...align, rows: out };
}

/**
 * Slack's data_table block: Slack adds search, paging and full screen. The
 * first row is the headers. Messages only, not forms. Rows past Slack's
 * limits (200 rows, 20 columns, 20,000 characters) are left out.
 */
function dataTable(caption: string, headers: readonly string[], rows: readonly (readonly Cell[])[], opts: { pageSize?: number } = {}): Block {
  const cols = LIMITS.dataTableColumns;
  const head = headers.slice(0, cols).map((h) => rawText(String(h ?? "")));
  let chars = head.reduce((n, c) => n + cellChars(c), 0);
  const body: Block[][] = [];
  for (const r of rows.slice(0, LIMITS.dataTableRows)) {
    const row = (Array.isArray(r) ? r : []).slice(0, cols).map(cell);
    chars += row.reduce((n, c) => n + cellChars(c), 0);
    if (chars > LIMITS.dataTableChars) break;
    body.push(row);
  }
  const pageSize = opts.pageSize && opts.pageSize > 0 ? { page_size: Math.floor(opts.pageSize) } : {};
  return { type: "data_table", caption: String(caption ?? ""), ...pageSize, rows: [head, ...body] };
}

export const blocks = { plan, taskCard, richText, table, dataTable };
