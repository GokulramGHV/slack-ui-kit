/**
 * OpenUI components for the newer Slack blocks. Each one calls a plain builder
 * from ./blocks.ts. createSlackKit adds them to the library by default.
 */
import { defineBlockComponent } from "@openuidev/channels";
import { library as stock } from "@openuidev/channels/slack";
import { markReactive } from "@openuidev/lang-core";
import { z } from "zod";
import { blocks, clipTo } from "./blocks.js";
/** Marks a prop as bound to a $variable, as OpenUI does for its own inputs. */
const reactive = (schema) => {
    markReactive(schema);
    return schema;
};
const text = (v) => (v == null ? "" : String(v));
const optional = (v) => (v == null || v === "" ? undefined : String(v));
export const Source = defineBlockComponent({
    name: "Source",
    description: "A link shown under a TaskCard: Source(label, url).",
    props: z.object({ label: z.string(), url: z.string() }),
    render: () => [],
});
export const TaskCard = defineBlockComponent({
    name: "TaskCard",
    description: 'One task with a status, shown as a compact line that opens to show details. status is "pending", "in_progress", "complete" or "error". Optional: details and output (text; <@U123> mentions work), sources (a list of Source). Use inside a Plan, or alone for a single task.',
    props: z.object({
        title: z.string(),
        status: z.string(),
        details: z.string().nullable().optional(),
        output: z.string().nullable().optional(),
        sources: z.array(Source.ref).nullable().optional(),
    }),
    render: ({ props, node, ctx }) => {
        if (!text(props.title).trim())
            return [];
        const task = blocks.taskCard(taskFrom(props, ctx.idFor(node, "task")));
        // Slack refuses a lone task_card with status "pending" but accepts it inside a plan.
        return [task.status === "pending" ? { type: "plan", title: task.title, tasks: [task] } : task];
    },
});
function taskFrom(p, id) {
    return {
        id,
        title: text(p.title),
        status: text(p.status),
        details: optional(p.details),
        output: optional(p.output),
        sources: (p.sources ?? []).map((s) => ({ label: text(s?.props?.label), url: text(s?.props?.url) })),
    };
}
export const Plan = defineBlockComponent({
    name: "Plan",
    description: "A titled checklist of tasks with live status, for showing progress. Update a task's status by changing state. e.g. Plan(\"Release\", [TaskCard(\"Build\", \"complete\"), TaskCard(\"Deploy\", \"in_progress\")]). Up to 50 tasks.",
    props: z.object({ title: z.string(), tasks: z.array(TaskCard.ref) }),
    render: ({ props, ctx }) => {
        const tasks = (props.tasks ?? [])
            .filter((n) => n?.props && text(n.props.title).trim())
            .map((n) => taskFrom(n.props, ctx.idFor(n, "task")));
        return tasks.length ? [blocks.plan(text(props.title), tasks)] : [];
    },
});
/** OpenUI's walk, typed as Slack blocks. */
const walk = (ctx, nodes) => ctx.walk(nodes);
const isElement = (n) => !!n && typeof n === "object" && n.type === "element";
/** Replaces OpenUI's Table: same output for text cells, plus number cells and alignment. */
export const Table = defineBlockComponent({
    name: "Table",
    description: 'A table. headers are the column titles; rows is an array of rows, each an array of cells (text, or numbers for numeric columns). Optional align: one of "left", "center", "right" per column. e.g. Table(["Title", "Points"], [["Fix login", 3], ["Write docs", 1]], ["left", "right"]).',
    props: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.union([z.string(), z.number()]))),
        align: z.array(z.string()).nullable().optional(),
    }),
    render: ({ props }) => {
        const headers = (props.headers ?? []).map(text);
        const rows = (props.rows ?? []).map((r) => (Array.isArray(r) ? r : []).map((c) => (typeof c === "number" ? c : text(c))));
        if (!headers.length && !rows.length)
            return [];
        return [blocks.table(headers, rows, { align: (props.align ?? undefined) })];
    },
});
export const DataTable = defineBlockComponent({
    name: "DataTable",
    description: 'A large table Slack can search, page and expand. Use for many rows; use Table for a few. Cells are text, numbers, or a Button. A Button in a row should @Set a $variable naming that row, so the bot knows which row was pressed: ["api", 12, Button("Diff", Action([@Set($repo, "api")]))]. Optional pageSize. Not inside a Form. Max 200 rows, 20 columns.',
    props: z.object({
        caption: z.string(),
        headers: z.array(z.string()),
        rows: z.array(z.array(z.union([z.string(), z.number(), stock.components.Button.ref, stock.components.LinkButton.ref]))),
        pageSize: z.number().nullable().optional(),
    }),
    render: ({ props, ctx }) => {
        const caption = text(props.caption);
        const rows = (props.rows ?? []).map((r) => (Array.isArray(r) ? r : []).map((c) => (isElement(c) ? (walk(ctx, c)[0] ?? "") : typeof c === "number" ? c : text(c))));
        if (!caption.trim() || !rows.length)
            return [];
        return [blocks.dataTable(caption, (props.headers ?? []).map(text), rows, { pageSize: props.pageSize ?? undefined })];
    },
});
const S = stock.components;
const buttonRefs = [S.Button.ref, S.LinkButton.ref];
export const Card = defineBlockComponent({
    name: "Card",
    description: 'A card with a title, optional body text and up to 3 buttons (more than 3 fails the render). Use several in a Carousel. Args in order: title, body?, actions?, subtitle? (a line under the title, 150 characters), subtext? (small text under the body, 200 characters), icon? (an image URL). Title and subtitle are clipped at 150 characters, body and subtext at 200; Slack markdown works in all four. Use null to skip an optional arg you do not need. A Button on a card should @Set a $variable naming that card, so the bot knows which one was pressed: Card("api", "12 commits ahead", [Button("Open", Action([@Set($picked, "api")]))], "main branch", "updated 2h ago", "https://example.com/api.png").',
    props: z.object({
        title: z.string(),
        body: z.string().nullable().optional(),
        actions: z.array(z.union(buttonRefs)).nullable().optional(),
        subtitle: z.string().nullable().optional(),
        subtext: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
    }),
    render: ({ props, ctx }) => {
        if (!text(props.title).trim())
            return [];
        return [
            blocks.card({
                title: text(props.title),
                body: optional(props.body),
                actions: walk(ctx, props.actions ?? []),
                subtitle: optional(props.subtitle),
                subtext: optional(props.subtext),
                icon: optional(props.icon),
            }),
        ];
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
        const list = (props.tags ?? []).map((n) => ({ text: text(n?.props?.text), color: optional(n?.props?.color) })).filter((t) => t.text.trim());
        return list.length ? [blocks.tags(list)] : [];
    },
});
export const Layout = defineBlockComponent({
    name: "Layout",
    description: 'A grid of Sections: 1 to 5 rows of 1 to 3 Sections each, with an optional line between rows. Use for side by side facts: Layout("Summary", [[Section("*Stage*\\nBuild"), Section("*Services*\\n3")]], true).',
    props: z.object({
        label: z.string(),
        rows: z.array(z.array(z.union([S.Section.ref, S.Fields.ref]))),
        gridLines: z.boolean().nullable().optional(),
    }),
    render: ({ props, ctx }) => {
        const rows = (props.rows ?? []).map((r) => walk(ctx, Array.isArray(r) ? r : [])).filter((r) => r.length);
        return rows.length ? [blocks.layout(text(props.label), rows, { gridLines: !!props.gridLines })] : [];
    },
});
export const Feedback = defineBlockComponent({
    name: "Feedback",
    description: 'Thumbs up and down buttons so readers can rate an answer. Anyone may press them by default and they never lock the card. Optional labels: Feedback("Helpful", "Not helpful").',
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
/**
 * Replaces OpenUI's Form: the same, plus Alert among the fields and a list of optional fields.
 * Alerts are saved on the form spec as `notices`, optional field names (without `$`) as `optional`.
 */
export const Form = defineBlockComponent({
    name: "Form",
    description: `${S.Form.description} Fields may include an Alert for a warning or note. Every field must be filled to submit, except those named in the fifth argument, a list of $variable names without the $: Form("Edit", "Save", [TextInput("Title", $title), NumberInput("Points", $points)], null, ["points"]). A Select or MultiSelect with no options is left out of the form.`,
    props: z.object({
        title: z.string(),
        submit: z.string(),
        fields: z.array(z.union([
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
        ])),
        action: z.any().optional(),
        optional: z.array(z.string()).nullable().optional(),
    }),
    render: ({ props, node, ctx }) => {
        const notices = [];
        const inputs = [];
        for (const f of props.fields ?? []) {
            if (f?.typeName === "Alert") {
                const t = text(f.props?.text);
                if (t.trim())
                    notices.push({ before: inputs.length, text: t, ...(optional(f.props?.level) ? { level: text(f.props.level) } : {}) });
            }
            else
                inputs.push(f);
        }
        const optionalNames = (props.optional ?? []).map((n) => text(n).replace(/^\$/, "")).filter(Boolean);
        const extra = { ...(notices.length ? { notices } : {}), ...(optionalNames.length ? { optional: optionalNames } : {}) };
        const inner = Object.keys(extra).length ? { ...ctx, registerForm: (id, spec) => ctx.registerForm(id, { ...spec, ...extra }) } : ctx;
        const { optional: _optional, ...stock } = props;
        return S.Form.component({ props: { ...stock, fields: inputs }, node, ctx: inner });
    },
});
export const Option = defineBlockComponent({
    name: "Option",
    description: "An option inside a Select, MultiSelect, Radio, Checkboxes, or Overflow: Option(value, label, description?). The optional description (up to 75 characters) is shown under the label in Radio and Checkboxes only; other inputs ignore it.",
    props: z.object({ value: z.string(), label: z.string(), description: z.string().nullable().optional() }),
    render: () => [],
});
const optionRefs = z.array(Option.ref);
/** Slack takes at most 75 characters in an option description. */
const clip = (t) => (t.length > 75 ? `${t.slice(0, 74)}…` : t);
/** Run OpenUI's own Radio or Checkboxes, then add each Option's description to the Slack option. */
function withDescriptions(stockComponent, name) {
    return defineBlockComponent({
        name,
        description: stockComponent.description,
        // The stock props keep the reactive $variable binding; only the options now point at the kit's Option.
        props: z.object({ ...stockComponent.props.shape, options: optionRefs }),
        render: ({ props, node, ctx }) => {
            const out = stockComponent.component({ props, node, ctx });
            const list = props.options ?? [];
            const describe = (o, i) => {
                const d = optional(list[i]?.props?.description)?.trim();
                return d ? { ...o, description: { type: "plain_text", text: clip(d) } } : o;
            };
            const fix = (el) => {
                if (!el || typeof el !== "object")
                    return el;
                if (el.type !== "radio_buttons" && el.type !== "checkboxes")
                    return el;
                const options = el.options ?? [];
                const withD = options.map(describe);
                const byValue = (o) => withD.find((x) => x.value === o.value) ?? o;
                return {
                    ...el,
                    options: withD,
                    ...(el.initial_option ? { initial_option: byValue(el.initial_option) } : {}),
                    ...(el.initial_options ? { initial_options: el.initial_options.map(byValue) } : {}),
                };
            };
            // OpenUI returns the bare input element; Root, Actions or Form wrap it in a block later.
            return out.map(fix);
        },
    });
}
export const Radio = withDescriptions(S.Radio, "Radio");
export const Checkboxes = withDescriptions(S.Checkboxes, "Checkboxes");
/**
 * Replaces OpenUI's NumberInput only to say it also works in Actions. The props are OpenUI's own, so
 * the $variable binding is kept. It renders nothing itself: Form and Actions read it.
 */
export const NumberInput = defineBlockComponent({
    name: "NumberInput",
    description: "A whole-number field bound to a $variable, inside a Form (shown in the modal) or inside Actions (an input on the message that saves when the user presses Enter). e.g. NumberInput(\"Points\", $points).",
    props: S.NumberInput.props,
    render: () => [],
});
/** A state entry (string or item) as an item. Undefined when it has no value. */
export function searchItem(v) {
    if (v == null || v === "")
        return undefined;
    if (typeof v === "object") {
        const o = v;
        if (o.value == null || o.value === "")
            return undefined;
        return { value: String(o.value), label: o.label == null || o.label === "" ? String(o.value) : String(o.label) };
    }
    return { value: String(v), label: String(v) };
}
export const SearchSelect = defineBlockComponent({
    name: "SearchSelect",
    description: 'A dropdown for long lists: the options are not listed here, Slack loads them as the user types. Only inside Actions. SearchSelect(name, $chosen, source, multi?). source is a short word the bot uses to know what to search, such as "people" or "projects". multi true allows several picks (default false). $chosen holds the picks as items {value, label}: an array when multi, one item (or null) when not. Start it empty: $chosen = [] or $chosen = null. e.g. Actions([SearchSelect("Assignee", $assignee, "people")]).',
    props: z.object({
        name: z.string(),
        values: reactive(z.any()),
        source: z.string(),
        multi: z.boolean().nullable().optional(),
    }),
    render: () => [],
});
/** Slack takes at most 75 characters in an option's text. */
const clipOption = (t) => clipTo(t, 75);
const plainText = (t) => ({ type: "plain_text", text: t });
/** One input block for a NumberInput or SearchSelect inside Actions. Registers the action. */
function messageInput(n, ctx) {
    const p = n.props ?? {};
    const id = ctx.idFor(n);
    const target = ctx.bindTarget(p.value ?? p.values);
    const current = target ? ctx.state[target] : undefined;
    if (n.typeName === "NumberInput") {
        if (target)
            ctx.registerAction(id, { kind: "input", target });
        return {
            type: "input",
            dispatch_action: true,
            label: plainText(text(p.label).slice(0, 2000) || "Number"),
            element: {
                type: "number_input",
                action_id: id,
                is_decimal_allowed: false,
                ...(current != null && current !== "" ? { initial_value: text(current) } : {}),
            },
        };
    }
    // SearchSelect
    if (target)
        ctx.registerAction(id, { kind: "input", target, source: text(p.source) });
    const multi = p.multi === true;
    const option = (i) => ({ text: plainText(clipOption(i.label)), value: i.value });
    const items = (Array.isArray(current) ? current : [current]).map(searchItem).filter((i) => !!i);
    const name = text(p.name);
    return {
        type: "input",
        dispatch_action: true,
        label: plainText(name.slice(0, 2000) || "Search"),
        element: {
            type: multi ? "multi_external_select" : "external_select",
            action_id: id,
            placeholder: plainText(name.slice(0, 150) || "Search"),
            min_query_length: 1,
            ...(multi ? (items.length ? { initial_options: items.map(option) } : {}) : items.length ? { initial_option: option(items[0]) } : {}),
        },
    };
}
const stockActions = S.Actions;
const stockActionItems = stockActions.props.shape.items.element.options;
/**
 * Replaces OpenUI's Actions: the same row of controls, plus NumberInput and SearchSelect. Like
 * OpenUI's multi-selects, those two get their own input block (with dispatch_action) after the row.
 */
export const Actions = defineBlockComponent({
    name: "Actions",
    description: `${stockActions.description} Also NumberInput(label, $var) for a whole number and SearchSelect(name, $var, source, multi?) for a long list searched as the user types. A Form may sit in the row: its button opens the form.`,
    props: z.object({ items: z.array(z.union([...stockActionItems, NumberInput.ref, SearchSelect.ref, Form.ref])) }),
    render: ({ props, node, ctx }) => {
        const items = (props.items ?? []).slice(0, 25);
        // One row in the order written; a Form puts its open-form button in the row. Inputs go after the row.
        const row = [];
        const inputs = [];
        for (const n of items) {
            if (isElement(n) && (n.typeName === "NumberInput" || n.typeName === "SearchSelect")) {
                const b = messageInput(n, ctx);
                if (b)
                    inputs.push(b);
            }
            else if (isElement(n) && n.typeName === "Form") {
                for (const b of Form.component({ props: n.props ?? {}, node: n, ctx })) {
                    if (b.type === "actions")
                        row.push(...(b.elements ?? []));
                }
            }
            else {
                for (const b of stockActions.component({ props: { ...props, items: [n] }, node, ctx })) {
                    if (b.type === "actions")
                        row.push(...(b.elements ?? []));
                    else
                        inputs.push(b);
                }
            }
        }
        return [...(row.length ? [{ type: "actions", elements: row }] : []), ...inputs];
    },
});
const childRefs = [S.Header.ref, S.Section.ref, S.Fields.ref, S.Context.ref, S.Divider.ref, S.Image.ref, S.Markdown.ref, S.RichText.ref, Table.ref, Tags.ref, Actions.ref];
export const Container = defineBlockComponent({
    name: "Container",
    description: "A titled group of up to 10 blocks (more than 10 fails the render; text, tables, tags and an Actions row of buttons and inputs), optionally collapsible and collapsed at first, with an optional width: \"narrow\", \"standard\", \"wide\" or \"full\". Use for a draft with its own buttons, or for details people may want to hide: Container(\"Details\", [Section(...), Table(...)], true, true, \"full\").",
    props: z.object({
        title: z.string(),
        children: z.array(z.union(childRefs)),
        collapsible: z.boolean().nullable().optional(),
        collapsed: z.boolean().nullable().optional(),
        width: z.string().nullable().optional(),
    }),
    render: ({ props, ctx }) => {
        const children = walk(ctx, props.children ?? []);
        if (!children.length)
            return [];
        return [blocks.container(text(props.title), children, { collapsible: !!props.collapsible, collapsed: !!props.collapsed, width: optional(props.width) })];
    },
});
/** Every component the kit adds to OpenUI's Slack library. */
export const KIT_COMPONENTS = {
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
        SearchSelect,
    ],
    override: [Table, Form, Option, Radio, Checkboxes, NumberInput, Actions],
};
/** A change entry's component name: either a component, or { component, slots }. */
const nameOf = (entry) => (typeof entry?.component === "function" ? entry.name : (entry?.component?.name ?? entry?.name));
/**
 * The kit's components plus the host's. A host component (added or overriding)
 * with the same name as one of the kit's replaces it; a host `remove` drops it.
 */
export function withKitComponents(host = {}) {
    const hostNames = new Set([...(host.add ?? []), ...(host.override ?? [])].map(nameOf).concat(host.remove ?? []));
    const keep = (list = []) => list.filter((e) => !hostNames.has(nameOf(e)));
    return {
        add: [...keep(KIT_COMPONENTS.add), ...(host.add ?? [])],
        override: [...keep(KIT_COMPONENTS.override), ...(host.override ?? [])],
        // Names the kit added don't exist in OpenUI's library, so dropping them above is enough.
        remove: (host.remove ?? []).filter((n) => !(KIT_COMPONENTS.add ?? []).some((e) => nameOf(e) === n)),
    };
}
//# sourceMappingURL=components.js.map