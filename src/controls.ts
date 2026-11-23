import type { RenderResult } from "@openuidev/channels";
import type { Block } from "./sanitize.js";
import type { ControlKind } from "./types.js";

/** action id -> what kind of control it is. Saved on the card so clicks are classified without rendering. */
export type Controls = Record<string, ControlKind>;

/** Calls `fn` for every object with a string action_id, at any depth. */
function eachElement(node: unknown, fn: (el: Record<string, any>) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) eachElement(n, fn);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, any>;
    if (typeof o.action_id === "string") fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") eachElement(v, fn);
  }
}

/**
 * Controls of an OpenUI render. Buttons and inputs come from OpenUI's
 * actionMap (so display-only buttons are left out), forms from its forms, and
 * feedback buttons from the Slack element type in the rendered blocks.
 */
export function controlsFromRender(result: Pick<RenderResult<Block[]>, "output" | "actionMap" | "forms">): Controls {
  const controls: Controls = {};
  for (const [id, entry] of Object.entries(result.actionMap ?? {})) {
    controls[id] = entry.kind === "action" ? "button" : "input";
  }
  for (const id of Object.keys(result.forms ?? {})) controls[`form:${id}`] = "form";
  eachElement(result.output, (el) => {
    if (el.type === "feedback_buttons") controls[el.action_id] = "feedback";
  });
  return controls;
}

/** Controls of raw blocks the host built, from each element's Slack type. Link buttons are skipped. */
export function controlsFromBlocks(blocks: readonly Block[]): Controls {
  const controls: Controls = {};
  eachElement(blocks, (el) => {
    if (el.type === "feedback_buttons") controls[el.action_id] = "feedback";
    else if (el.type === "button") {
      if (!el.url) controls[el.action_id] = "button";
    } else controls[el.action_id] = "input";
  });
  return controls;
}

const CHOICE_TYPES = new Set(["radio_buttons", "checkboxes", "static_select", "multi_static_select", "overflow"]);

/**
 * Shown option text of each $state variable bound to a choice input. Keys carry the `$`, like
 * the card's state. A value that matches no option is left out. Undefined when nothing is found.
 */
export function stateLabelsFromRender(
  result: Pick<RenderResult<Block[]>, "output" | "actionMap">,
  state: Record<string, unknown>,
): Record<string, string | string[]> | undefined {
  const out: Record<string, string | string[]> = {};
  eachElement(result.output, (el) => {
    const entry = result.actionMap?.[el.action_id];
    if (!entry || entry.kind !== "input" || !CHOICE_TYPES.has(el.type)) return;
    const key = entry.target.startsWith("$") ? entry.target : `$${entry.target}`;
    const current = state[key] ?? state[entry.target];
    const options: any[] = [...(el.options ?? []), ...(el.option_groups ?? []).flatMap((g: any) => g.options ?? [])];
    const textOf = (v: unknown): string | undefined => {
      const t = options.find((o) => o?.value === v)?.text?.text;
      return typeof t === "string" ? t : undefined;
    };
    if (Array.isArray(current)) {
      const texts = current.map(textOf).filter((t): t is string => t !== undefined);
      if (texts.length) out[key] = texts;
    } else {
      const t = textOf(current);
      if (t !== undefined) out[key] = t;
    }
  });
  return Object.keys(out).length ? out : undefined;
}
