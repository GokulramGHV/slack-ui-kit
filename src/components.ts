/**
 * OpenUI components for the newer Slack blocks. Each one calls a plain builder
 * from ./blocks.ts. createSlackKit adds them to the library by default.
 */
import { defineBlockComponent } from "@openuidev/channels";
import { library as stock } from "@openuidev/channels/slack";
import { z } from "zod";
import { blocks, type Align, type Cell, type TaskInput } from "./blocks.js";
import type { ComponentChanges } from "./openui/library.js";
import type { Block } from "./sanitize.js";

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

/** OpenUI's walk, typed as Slack blocks. */
const walk = (ctx: { walk: (n: unknown) => unknown[] }, nodes: unknown): Block[] => ctx.walk(nodes) as Block[];

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
      (Array.isArray(r) ? r : []).map((c: any): Cell => (isElement(c) ? (walk(ctx, c)[0] ?? "") : typeof c === "number" ? c : text(c))),
    );
    if (!caption.trim() || !rows.length) return [];
    return [blocks.dataTable(caption, (props.headers ?? []).map(text), rows, { pageSize: props.pageSize ?? undefined })];
  },
});

const S = stock.components;
const buttonRefs = [S.Button.ref, S.LinkButton.ref] as const;

export const Card = defineBlockComponent({
  name: "Card",
  description:
    'A card with a title, optional body text and up to 3 buttons. Use several in a Carousel. A Button on a card should @Set a $variable naming that card, so the bot knows which one was pressed: Card("api", "12 commits ahead", [Button("Open", Action([@Set($picked, "api")]))]).',
  props: z.object({
    title: z.string(),
    body: z.string().nullable().optional(),
    actions: z.array(z.union(buttonRefs)).nullable().optional(),
  }),
  render: ({ props, ctx }) => {
    if (!text(props.title).trim()) return [];
    return [blocks.card({ title: text(props.title), body: optional(props.body), actions: walk(ctx, props.actions ?? []) })];
  },
});

export const Carousel = defineBlockComponent({
  name: "Carousel",
  description: "1 to 10 Cards side by side that scroll sideways. e.g. Carousel([Card(...), Card(...)]).",
  props: z.object({ cards: z.array(Card.ref) }),
  render: ({ props, ctx }) => {
    const cards = walk(ctx, props.cards ?? []);
    return cards.length ? [blocks.carousel(cards)] : [];
  },
});

export const Tag = defineBlockComponent({
  name: "Tag",
  description: 'One colored label inside Tags. color: "gray", "brown", "purple", "indigo", "blue", "green", "yellow", "orange" or "red".',
  props: z.object({ text: z.string(), color: z.string().nullable().optional() }),
  render: () => [],
});

export const Tags = defineBlockComponent({
  name: "Tags",
  description: 'A row of colored labels, e.g. for statuses: Tags([Tag("ready", "green"), Tag("skipped", "orange")]).',
  props: z.object({ tags: z.array(Tag.ref) }),
  render: ({ props }) => {
    const list = (props.tags ?? []).map((n: any) => ({ text: text(n?.props?.text), color: optional(n?.props?.color) as any })).filter((t: any) => t.text.trim());
    return list.length ? [blocks.tags(list)] : [];
  },
});

const childRefs = [S.Header.ref, S.Section.ref, S.Fields.ref, S.Context.ref, S.Divider.ref, S.Image.ref, S.Markdown.ref, S.RichText.ref, Table.ref, Tags.ref] as const;

export const Container = defineBlockComponent({
  name: "Container",
  description:
    "A titled group of up to 10 display blocks (no buttons or inputs), optionally collapsible and collapsed at first. Use for details people may want to hide: Container(\"Details\", [Section(...), Table(...)], true, true).",
  props: z.object({
    title: z.string(),
    children: z.array(z.union(childRefs)),
    collapsible: z.boolean().nullable().optional(),
    collapsed: z.boolean().nullable().optional(),
  }),
  render: ({ props, ctx }) => {
    const children = walk(ctx, props.children ?? []);
    if (!children.length) return [];
    return [blocks.container(text(props.title), children, { collapsible: !!props.collapsible, collapsed: !!props.collapsed })];
  },
});

export const Layout = defineBlockComponent({
  name: "Layout",
  description:
    'A grid of Sections: 1 to 5 rows of 1 to 3 Sections each, with an optional line between rows. Use for side by side facts: Layout("Summary", [[Section("*Stage*\\nBuild"), Section("*Services*\\n3")]], true).',
  props: z.object({
    label: z.string(),
    rows: z.array(z.array(z.union([S.Section.ref, S.Fields.ref]))),
    gridLines: z.boolean().nullable().optional(),
  }),
  render: ({ props, ctx }) => {
    const rows = (props.rows ?? []).map((r: any) => walk(ctx, Array.isArray(r) ? r : [])).filter((r: any[]) => r.length);
    return rows.length ? [blocks.layout(text(props.label), rows, { gridLines: !!props.gridLines })] : [];
  },
});

export const Feedback = defineBlockComponent({
  name: "Feedback",
  description:
    'Thumbs up and down buttons so readers can rate an answer. Anyone may press them by default and they never lock the card. Optional labels: Feedback("Helpful", "Not helpful").',
  props: z.object({ positive: z.string().nullable().optional(), negative: z.string().nullable().optional() }),
  render: ({ props, node, ctx }) => [
    blocks.feedback({ actionId: ctx.idFor(node, "feedback"), positive: optional(props.positive), negative: optional(props.negative) }),
  ],
});

export const Alert = defineBlockComponent({
  name: "Alert",
  description: 'A notice shown inside a Form, above or between fields. level: "info", "warning", "error" or "success". e.g. Alert("This cannot be undone.", "warning").',
  props: z.object({ text: z.string(), level: z.string().nullable().optional() }),
  render: () => [],
});

/** A notice inside a form: shown before the field at index `before` (or at the end). */
export type FormNotice = { before: number; text: string; level?: string };

/** Replaces OpenUI's Form: the same, plus Alert among the fields. Alerts are saved on the form spec as `notices`. */
export const Form = defineBlockComponent({
  name: "Form",
  description: `${S.Form.description} Fields may include an Alert for a warning or note.`,
  props: z.object({
    title: z.string(),
    submit: z.string(),
    fields: z.array(
      z.union([
        S.TextInput.ref,
        S.TextArea.ref,
        S.NumberInput.ref,
        S.EmailInput.ref,
        S.URLInput.ref,
        S.Select.ref,
        S.MultiSelect.ref,
        S.DatePicker.ref,
        S.TimePicker.ref,
        S.DateTimePicker.ref,
        Alert.ref,
      ]),
    ),
    action: z.any().optional(),
  }),
  render: ({ props, node, ctx }) => {
    const notices: FormNotice[] = [];
    const inputs: unknown[] = [];
    for (const f of props.fields ?? []) {
      if ((f as any)?.typeName === "Alert") {
        const t = text((f as any).props?.text);
        if (t.trim()) notices.push({ before: inputs.length, text: t, ...(optional((f as any).props?.level) ? { level: text((f as any).props.level) } : {}) });
      } else inputs.push(f);
    }
    const inner = notices.length ? { ...ctx, registerForm: (id: string, spec: any) => ctx.registerForm(id, { ...spec, notices }) } : ctx;
    return (S.Form as any).component({ props: { ...props, fields: inputs }, node, ctx: inner });
  },
});

/** Every component the kit adds to OpenUI's Slack library. */
export const KIT_COMPONENTS: ComponentChanges = {
  add: [
    { component: Plan, slots: ["Root"] },
    { component: TaskCard, slots: ["Root"] },
    Source,
    { component: DataTable, slots: ["Root"] },
    { component: Card, slots: ["Root"] },
    { component: Carousel, slots: ["Root"] },
    { component: Container, slots: ["Root"] },
    { component: Layout, slots: ["Root"] },
    { component: Feedback, slots: ["Root"] },
    { component: Tags, slots: ["Root"] },
    Tag,
    Alert,
  ],
  override: [Table, Form],
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
