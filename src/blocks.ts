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

export const LIMITS = {
  planTasks: 50,
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

export const blocks = { plan, taskCard, richText };
