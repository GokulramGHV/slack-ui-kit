/**
 * Plain Block Kit builders for the newer Slack blocks. Host code can use these
 * directly (progress messages, templates) and the OpenUI components call them.
 * Shapes follow what Slack accepted in a live test on 2026-11-22.
 */
import type { Block } from "./sanitize.js";
export type TaskStatus = "pending" | "in_progress" | "complete" | "error";
export type Source = {
    label: string;
    url: string;
};
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
export declare const LIMITS: {
    readonly planTasks: 50;
    readonly tableRows: 100;
    readonly tableColumns: 20;
    readonly dataTableRows: 200;
    readonly dataTableColumns: 20;
    readonly dataTableChars: 20000;
    readonly cardActions: 3;
    readonly carouselCards: 10;
    readonly containerChildren: 10;
    readonly layoutRows: 5;
    readonly layoutItems: 3;
};
export type TagColor = "gray" | "brown" | "purple" | "indigo" | "blue" | "green" | "yellow" | "orange" | "red";
export type AlertLevel = "default" | "info" | "warning" | "error" | "success";
/** One rich_text block from a line of text. Mentions and Slack date tokens become their own elements. */
export declare function richText(text: string): Block;
declare function taskCard(task: TaskInput, index?: number): Block;
declare function plan(title: string, tasks: readonly TaskInput[]): Block;
/** Slack refuses a table cell with empty text, so an empty cell holds one space. */
export declare const EMPTY_CELL_TEXT = " ";
/**
 * Slack's table block. Matches OpenUI's own Table (bold header row, text
 * cells), and adds number cells and per-column alignment.
 */
declare function table(headers: readonly string[], rows: readonly (readonly Cell[])[], opts?: {
    align?: readonly Align[];
}): Block;
/**
 * Slack's data_table block: Slack adds search, paging and full screen. The
 * first row is the headers. Messages only, not forms. Rows past Slack's
 * limits (200 rows, 20 columns, 20,000 characters) are left out.
 */
declare function dataTable(caption: string, headers: readonly string[], rows: readonly (readonly Cell[])[], opts?: {
    pageSize?: number;
}): Block;
/** Slack's card block: a title, optional body, and up to 3 buttons. */
declare function card(c: {
    title: string;
    body?: string;
    actions?: readonly Block[];
}): Block;
/** Cards side by side that scroll sideways. 1 to 10 cards. */
declare function carousel(cards: readonly Block[]): Block;
/** A titled group of up to 10 blocks that can be collapsed. */
declare function container(title: string, children: readonly Block[], opts?: {
    collapsible?: boolean;
    collapsed?: boolean;
}): Block;
/** A grid: 1 to 5 rows of 1 to 3 blocks each. */
declare function layout(label: string, rows: readonly (readonly Block[])[], opts?: {
    gridLines?: boolean;
}): Block;
/** Thumbs up and down. A click's value is "positive" or "negative". Messages only. */
declare function feedback(opts?: {
    actionId?: string;
    positive?: string;
    negative?: string;
}): Block;
/** A row of colored tags. */
declare function tags(list: readonly {
    text: string;
    color?: TagColor;
}[]): Block;
/**
 * Slack's alert block. Slack refuses it in messages, so the kit only offers
 * it inside forms. Not yet confirmed in a modal by a live test.
 */
declare function alert(text: string, level?: AlertLevel): Block;
export declare const blocks: {
    plan: typeof plan;
    taskCard: typeof taskCard;
    richText: typeof richText;
    table: typeof table;
    dataTable: typeof dataTable;
    card: typeof card;
    carousel: typeof carousel;
    container: typeof container;
    layout: typeof layout;
    feedback: typeof feedback;
    tags: typeof tags;
    alert: typeof alert;
};
export {};
