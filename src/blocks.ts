/**
 * Plain Block Kit builders for the newer Slack blocks. Host code can use these
 * directly (progress messages, templates) and the OpenUI components call them.
 * Shapes follow what Slack accepted in a live test on 2026-11-22.
 */
import type { Block } from "./sanitize.js";

export type TaskStatus = "pending" | "in_progress" | "complete" | "error";
export type Source = { label: string; url: string };
/** One task. A task_card on its own may not be "pending" (Slack refuses it); inside a plan it may. */
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
  cardActions: 3,
  carouselCards: 10,
  containerChildren: 10,
  layoutRows: 5,
  layoutItems: 3,
} as const;

export type TagColor = "gray" | "brown" | "purple" | "indigo" | "blue" | "green" | "yellow" | "orange" | "red";
export type AlertLevel = "default" | "info" | "warning" | "error" | "success";

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
/** Slack refuses a table cell with empty text, so an empty cell holds one space. */
export const EMPTY_CELL_TEXT = " ";
const cellText = (text: string) => (text === "" ? EMPTY_CELL_TEXT : text);
const rawText = (text: string) => ({ type: "raw_text", text: cellText(text) });
const boldText = (text: string) => ({
  type: "rich_text",
  elements: [{ type: "rich_text_section", elements: [{ type: "text", text: cellText(text), style: { bold: true } }] }],
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
  const align = Array.isArray(opts.align) && opts.align.length ? { column_settings: opts.align.slice(0, cols).map((a) => ({ align: ALIGNS.has(a) ? a : "left" })) } : {};
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

const mrkdwn = (text: string) => ({ type: "mrkdwn", text });
const plainText = (text: string) => ({ type: "plain_text", text });

/** Slack's card block: a title, optional body, and up to 3 buttons. */
function card(c: { title: string; body?: string; actions?: readonly Block[] }): Block {
  const actions = (c.actions ?? []).slice(0, LIMITS.cardActions);
  return {
    type: "card",
    title: mrkdwn(String(c.title ?? "")),
    ...(filled(c.body) ? { body: mrkdwn(c.body) } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

/** Cards side by side that scroll sideways. 1 to 10 cards. */
function carousel(cards: readonly Block[]): Block {
  return { type: "carousel", elements: cards.slice(0, LIMITS.carouselCards) };
}

/** A titled group of up to 10 blocks that can be collapsed. */
function container(title: string, children: readonly Block[], opts: { collapsible?: boolean; collapsed?: boolean } = {}): Block {
  return {
    type: "container",
    title: plainText(String(title ?? "")),
    ...(opts.collapsible ? { is_collapsible: true } : {}),
    ...(opts.collapsible && opts.collapsed ? { default_collapsed: true } : {}),
    child_blocks: children.slice(0, LIMITS.containerChildren),
  };
}

/** A grid: 1 to 5 rows of 1 to 3 blocks each. */
function layout(label: string, rows: readonly (readonly Block[])[], opts: { gridLines?: boolean } = {}): Block {
  return {
    type: "layout",
    label: String(label ?? ""),
    ...(opts.gridLines ? { grid_lines: "rows" } : {}),
    rows: rows.slice(0, LIMITS.layoutRows).map((r) => ({ items: r.slice(0, LIMITS.layoutItems).map((block) => ({ block })) })),
  };
}

/** Thumbs up and down. A click's value is "positive" or "negative". Messages only. */
function feedback(opts: { actionId?: string; positive?: string; negative?: string } = {}): Block {
  return {
    type: "context_actions",
    elements: [
      {
        type: "feedback_buttons",
        action_id: opts.actionId || "feedback",
        positive_button: { text: plainText(opts.positive || "Good"), value: "positive" },
        negative_button: { text: plainText(opts.negative || "Bad"), value: "negative" },
      },
    ],
  };
}

const TAG_COLORS: ReadonlySet<string> = new Set(["gray", "brown", "purple", "indigo", "blue", "green", "yellow", "orange", "red"]);

/** A row of colored tags. */
function tags(list: readonly { text: string; color?: TagColor }[]): Block {
  const elements: Block[] = [];
  for (const t of list.filter((t) => filled(t?.text))) {
    if (elements.length) elements.push({ type: "text", text: " " });
    elements.push({ type: "tag", text: t.text, color: t.color && TAG_COLORS.has(t.color) ? t.color : "gray" });
  }
  return { type: "rich_text", elements: [{ type: "rich_text_section", elements }] };
}

const ALERT_LEVELS: ReadonlySet<string> = new Set(["default", "info", "warning", "error", "success"]);

/**
 * Slack's alert block. Slack refuses it in messages, so the kit only offers
 * it inside forms. Not yet confirmed in a modal by a live test.
 */
function alert(text: string, level?: AlertLevel): Block {
  return { type: "alert", ...(level && ALERT_LEVELS.has(level) ? { level } : {}), text: mrkdwn(String(text ?? "")) };
}

export const blocks = { plan, taskCard, richText, table, dataTable, card, carousel, container, layout, feedback, tags, alert };
