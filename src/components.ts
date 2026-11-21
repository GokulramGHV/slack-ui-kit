/**
 * OpenUI components for the newer Slack blocks. Each one calls a plain builder
 * from ./blocks.ts. createSlackKit adds them to the library by default.
 */
import { defineBlockComponent } from "@openuidev/channels";
import { library as stock } from "@openuidev/channels/slack";
import { z } from "zod";
import { blocks, type Align, type Cell, type TaskInput } from "./blocks.js";
import type { ComponentChanges } from "./openui/library.js";

const text = (v: unknown) => (v == null ? "" : String(v));
const optional = (v: unknown) => (v == null || v === "" ? undefined : String(v));

export const Source = defineBlockComponent({
  name: "Source",
  description: "A link shown under a TaskCard: Source(label, url).",
  props: z.object({ label: z.string(), url: z.string() }),
  render: () => [],
});

export const TaskCard = defineBlockComponent({
  name: "TaskCard",
  description:
    'One task with a status, shown as a compact line that opens to show details. status is "pending", "in_progress", "complete" or "error". Optional: details and output (text; <@U123> mentions work), sources (a list of Source). Use inside a Plan, or alone for a single task.',
  props: z.object({
    title: z.string(),
    status: z.string(),
    details: z.string().nullable().optional(),
    output: z.string().nullable().optional(),
    sources: z.array(Source.ref).nullable().optional(),
  }),
  render: ({ props, node, ctx }) => {
    if (!text(props.title).trim()) return [];
    return [blocks.taskCard(taskFrom(props, ctx.idFor(node, "task")))];
  },
});

function taskFrom(p: any, id: string): TaskInput {
  return {
    id,
    title: text(p.title),
    status: text(p.status) as TaskInput["status"],
    details: optional(p.details),
    output: optional(p.output),
    sources: (p.sources ?? []).map((s: any) => ({ label: text(s?.props?.label), url: text(s?.props?.url) })),
  };
}

export const Plan = defineBlockComponent({
  name: "Plan",
  description:
    "A titled checklist of tasks with live status, for showing progress. Update a task's status by changing state. e.g. Plan(\"Release\", [TaskCard(\"Build\", \"complete\"), TaskCard(\"Deploy\", \"in_progress\")]). Up to 50 tasks.",
  props: z.object({ title: z.string(), tasks: z.array(TaskCard.ref) }),
  render: ({ props, ctx }) => {
    const tasks = (props.tasks ?? [])
      .filter((n: any) => n?.props && text(n.props.title).trim())
      .map((n: any) => taskFrom(n.props, ctx.idFor(n, "task")));
    return tasks.length ? [blocks.plan(text(props.title), tasks)] : [];
  },
});

const isElement = (n: any) => !!n && typeof n === "object" && n.type === "element";

/** Replaces OpenUI's Table: same output for text cells, plus number cells and alignment. */
export const Table = defineBlockComponent({
  name: "Table",
  description:
    'A table. headers are the column titles; rows is an array of rows, each an array of cells (text, or numbers for numeric columns). Optional align: one of "left", "center", "right" per column. e.g. Table(["Title", "Points"], [["Fix login", 3], ["Write docs", 1]], ["left", "right"]).',
  props: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
    align: z.array(z.string()).nullable().optional(),
  }),
  render: ({ props }) => {
    const headers = (props.headers ?? []).map(text);
    const rows = (props.rows ?? []).map((r: any) => (Array.isArray(r) ? r : []).map((c: any) => (typeof c === "number" ? c : text(c))));
    if (!headers.length && !rows.length) return [];
    return [blocks.table(headers, rows, { align: (props.align ?? undefined) as Align[] | undefined })];
  },
});

export const DataTable = defineBlockComponent({
  name: "DataTable",
  description:
    'A large table Slack can search, page and expand. Use for many rows; use Table for a few. Cells are text, numbers, or a Button. A Button in a row should @Set a $variable naming that row, so the bot knows which row was pressed: ["api", 12, Button("Diff", Action([@Set($repo, "api")]))]. Optional pageSize. Not inside a Form. Max 200 rows, 20 columns.',
  props: z.object({
    caption: z.string(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), stock.components.Button.ref, stock.components.LinkButton.ref]))),
    pageSize: z.number().nullable().optional(),
  }),
  render: ({ props, ctx }) => {
    const caption = text(props.caption);
    const rows: Cell[][] = (props.rows ?? []).map((r: any) =>
      (Array.isArray(r) ? r : []).map((c: any): Cell => (isElement(c) ? (ctx.walk(c)[0] ?? "") : typeof c === "number" ? c : text(c))),
    );
    if (!caption.trim() || !rows.length) return [];
    return [blocks.dataTable(caption, (props.headers ?? []).map(text), rows, { pageSize: props.pageSize ?? undefined })];
  },
});

/** Every component the kit adds to OpenUI's Slack library. */
export const KIT_COMPONENTS: ComponentChanges = {
  add: [
    { component: Plan, slots: ["Root"] },
    { component: TaskCard, slots: ["Root"] },
    Source,
    { component: DataTable, slots: ["Root"] },
  ],
  override: [Table],
};

const nameOf = (entry: any): string | undefined => entry?.component?.name ?? entry?.name;

/**
 * The kit's components plus the host's. A host component (added or overriding)
 * with the same name as one of the kit's replaces it; a host `remove` drops it.
 */
export function withKitComponents(host: ComponentChanges = {}): ComponentChanges {
  const hostNames = new Set([...(host.add ?? []), ...(host.override ?? [])].map(nameOf).concat(host.remove ?? []));
  const keep = (list: readonly any[] = []) => list.filter((e) => !hostNames.has(nameOf(e)!));
  return {
    add: [...keep(KIT_COMPONENTS.add), ...(host.add ?? [])],
    override: [...keep(KIT_COMPONENTS.override), ...(host.override ?? [])],
    // Names the kit added don't exist in OpenUI's library, so dropping them above is enough.
    remove: (host.remove ?? []).filter((n) => !(KIT_COMPONENTS.add ?? []).some((e) => nameOf(e) === n)),
  } as ComponentChanges;
}
