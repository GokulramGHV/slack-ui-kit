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
    cardTitle: 150,
    cardSubtitle: 150,
    cardBody: 200,
    cardSubtext: 200,
};
const STATUSES = new Set(["pending", "in_progress", "complete", "error"]);
const filled = (s) => typeof s === "string" && s.trim() !== "";
const TOKEN = /(<@[A-Z0-9]+>|<!date\^\d+\^[^|>]+\|[^>]*>)/;
/** One rich_text block from a line of text. Mentions and Slack date tokens become their own elements. */
export function richText(text) {
    const elements = String(text)
        .split(TOKEN)
        .filter(Boolean)
        .map((part) => {
        const user = part.match(/^<@([A-Z0-9]+)>$/);
        if (user)
            return { type: "user", user_id: user[1] };
        const date = part.match(/^<!date\^(\d+)\^([^|>]+)\|([^>]*)>$/);
        if (date)
            return { type: "date", timestamp: Number(date[1]), format: date[2], fallback: date[3] };
        return { type: "text", text: part };
    });
    return { type: "rich_text", elements: [{ type: "rich_text_section", elements }] };
}
function taskCard(task, index = 0) {
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
function plan(title, tasks) {
    return { type: "plan", title: String(title ?? ""), tasks: tasks.slice(0, LIMITS.planTasks).map((t, i) => taskCard(t, i)) };
}
const ALIGNS = new Set(["left", "center", "right"]);
/** Slack refuses a table cell with empty text, so an empty cell holds one space. */
export const EMPTY_CELL_TEXT = " ";
const cellText = (text) => (text === "" ? EMPTY_CELL_TEXT : text);
const rawText = (text) => ({ type: "raw_text", text: cellText(text) });
const boldText = (text) => ({
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: [{ type: "text", text: cellText(text), style: { bold: true } }] }],
});
function cell(c) {
    if (typeof c === "number")
        return { type: "raw_number", value: c, text: String(c) };
    if (c && typeof c === "object")
        return c.type === "button" ? { type: "action_cell", element: c } : c;
    return rawText(c == null ? "" : String(c));
}
const cellChars = (c) => String(c.text ?? c.element?.text?.text ?? "").length;
/**
 * Slack's table block. Matches OpenUI's own Table (bold header row, text
 * cells), and adds number cells and per-column alignment.
 */
function table(headers, rows, opts = {}) {
    const cols = LIMITS.tableColumns;
    const out = [];
    if (headers.length)
        out.push(headers.slice(0, cols).map((h) => boldText(String(h ?? ""))));
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
function dataTable(caption, headers, rows, opts = {}) {
    const cols = LIMITS.dataTableColumns;
    const head = headers.slice(0, cols).map((h) => rawText(String(h ?? "")));
    let chars = head.reduce((n, c) => n + cellChars(c), 0);
    const body = [];
    for (const r of rows.slice(0, LIMITS.dataTableRows)) {
        const row = (Array.isArray(r) ? r : []).slice(0, cols).map(cell);
        chars += row.reduce((n, c) => n + cellChars(c), 0);
        if (chars > LIMITS.dataTableChars)
            break;
        body.push(row);
    }
    const pageSize = opts.pageSize && opts.pageSize > 0 ? { page_size: Math.floor(opts.pageSize) } : {};
    return { type: "data_table", caption: String(caption ?? ""), ...pageSize, rows: [head, ...body] };
}
const mrkdwn = (text) => ({ type: "mrkdwn", text });
const plainText = (text) => ({ type: "plain_text", text });
/**
 * Clip text to `max` characters, ending in an ellipsis when it was cut. The cut steps back so it never
 * splits an emoji (surrogate pair), a `<...>` token (mention, link, date) or a `:emoji:` shortcode.
 */
export function clipTo(text, max) {
    if (text.length <= max)
        return text;
    let cut = max - 1;
    const high = (i) => text.charCodeAt(i) >= 0xd800 && text.charCodeAt(i) <= 0xdbff;
    if (cut > 0 && high(cut - 1))
        cut--;
    const head = text.slice(0, cut);
    const open = head.lastIndexOf("<");
    if (open > head.lastIndexOf(">") && /^<[^\s<>]/.test(text.slice(open)) && text.indexOf(">", cut) !== -1)
        cut = open;
    const colon = text.slice(0, cut).lastIndexOf(":");
    if (colon !== -1 && /^:[\w+-]*$/.test(text.slice(colon, cut)) && /^[\w+-]*:/.test(text.slice(cut)))
        cut = colon;
    return `${text.slice(0, cut)}…`;
}
const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\/\S+$/i.test(s.trim());
/**
 * Slack's card block: a title, optional subtitle, body and subtext, an optional
 * icon, and up to 3 buttons (more fail the render, see checkLimits). Text past Slack's limits (title and subtitle 150
 * characters, body and subtext 200) is clipped with an ellipsis.
 */
function card(c) {
    const actions = [...(c.actions ?? [])];
    const title = clipTo(String(c.title ?? ""), LIMITS.cardTitle);
    return {
        type: "card",
        title: mrkdwn(title),
        ...(filled(c.subtitle) ? { subtitle: mrkdwn(clipTo(c.subtitle, LIMITS.cardSubtitle)) } : {}),
        ...(filled(c.body) ? { body: mrkdwn(clipTo(c.body, LIMITS.cardBody)) } : {}),
        ...(filled(c.subtext) ? { subtext: mrkdwn(clipTo(c.subtext, LIMITS.cardSubtext)) } : {}),
        ...(isHttpUrl(c.icon) ? { icon: { type: "image", image_url: c.icon.trim(), alt_text: title.trim() ? title : "icon" } } : {}),
        ...(actions.length ? { actions } : {}),
    };
}
/** Cards side by side that scroll sideways. 1 to 10 cards. */
function carousel(cards) {
    return { type: "carousel", elements: cards.slice(0, LIMITS.carouselCards) };
}
const CONTAINER_WIDTHS = new Set(["narrow", "standard", "wide", "full"]);
/**
 * A titled group of up to 10 blocks that can be collapsed. Slack allows display, actions and input blocks inside.
 * Children are not cut here: the card engine fails a render that has more than LIMITS.containerChildren
 * (see checkLimits), because dropping the tail would drop its buttons without a word.
 */
function container(title, children, opts = {}) {
    return {
        type: "container",
        title: plainText(String(title ?? "")),
        ...(opts.width && CONTAINER_WIDTHS.has(opts.width) ? { width: opts.width } : {}),
        ...(opts.collapsible ? { is_collapsible: true } : {}),
        ...(opts.collapsible && opts.collapsed ? { default_collapsed: true } : {}),
        child_blocks: [...children],
    };
}
/** A grid: 1 to 5 rows of 1 to 3 blocks each. */
function layout(label, rows, opts = {}) {
    return {
        type: "layout",
        label: String(label ?? ""),
        ...(opts.gridLines ? { grid_lines: "rows" } : {}),
        rows: rows.slice(0, LIMITS.layoutRows).map((r) => ({ items: r.slice(0, LIMITS.layoutItems).map((block) => ({ block })) })),
    };
}
/** Thumbs up and down. A click's value is "positive" or "negative". Messages only. */
function feedback(opts = {}) {
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
const TAG_COLORS = new Set(["gray", "brown", "purple", "indigo", "blue", "green", "yellow", "orange", "red"]);
/** A row of colored tags. */
function tags(list) {
    const elements = [];
    for (const t of list.filter((t) => filled(t?.text))) {
        if (elements.length)
            elements.push({ type: "text", text: " " });
        elements.push({ type: "tag", text: t.text, color: t.color && TAG_COLORS.has(t.color) ? t.color : "gray" });
    }
    return { type: "rich_text", elements: [{ type: "rich_text_section", elements }] };
}
const ALERT_LEVELS = new Set(["default", "info", "warning", "error", "success"]);
/**
 * Slack's alert block. Slack refuses it in messages, so the kit only offers
 * it inside forms. Not yet confirmed in a modal by a live test.
 */
function alert(text, level) {
    return { type: "alert", ...(level && ALERT_LEVELS.has(level) ? { level } : {}), text: mrkdwn(String(text ?? "")) };
}
export const blocks = { plan, taskCard, richText, table, dataTable, card, carousel, container, layout, feedback, tags, alert };
//# sourceMappingURL=blocks.js.map