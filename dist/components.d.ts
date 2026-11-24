import type { ComponentChanges } from "./openui/library.js";
export declare const Source: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const TaskCard: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Plan: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/** Replaces OpenUI's Table: same output for text cells, plus number cells and alignment. */
export declare const Table: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const DataTable: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Card: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Carousel: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Tag: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Tags: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Layout: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Feedback: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Alert: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/** A notice inside a form: shown before the field at index `before` (or at the end). */
export type FormNotice = {
    before: number;
    text: string;
    level?: string;
};
/** Replaces OpenUI's Form: the same, plus Alert among the fields. Alerts are saved on the form spec as `notices`. */
export declare const Form: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Option: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Radio: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Checkboxes: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/**
 * Replaces OpenUI's NumberInput only to say it also works in Actions. The props are OpenUI's own, so
 * the $variable binding is kept. It renders nothing itself: Form and Actions read it.
 */
export declare const NumberInput: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/** What a SearchSelect's state holds: items with a value and the label to show. Plain strings are accepted too. */
export type SearchItem = {
    value: string;
    label: string;
};
/** A state entry (string or item) as an item. Undefined when it has no value. */
export declare function searchItem(v: unknown): SearchItem | undefined;
export declare const SearchSelect: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/**
 * Replaces OpenUI's Actions: the same row of controls, plus NumberInput and SearchSelect. Like
 * OpenUI's multi-selects, those two get their own input block (with dispatch_action) after the row.
 */
export declare const Actions: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
export declare const Container: import("@openuidev/lang-core").DefinedComponent<any, import("@openuidev/channels").RenderFn>;
/** Every component the kit adds to OpenUI's Slack library. */
export declare const KIT_COMPONENTS: ComponentChanges;
/**
 * The kit's components plus the host's. A host component (added or overriding)
 * with the same name as one of the kit's replaces it; a host `remove` drops it.
 */
export declare function withKitComponents(host?: ComponentChanges): ComponentChanges;
