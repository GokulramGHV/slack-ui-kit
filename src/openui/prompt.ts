import type { ToolSpec } from "@openuidev/lang-core";
import type { SlackLibrary } from "./library.js";

/**
 * OpenUI's built-in prompt rules, copied from buildSystemPrompt in
 * @openuidev/channels 0.1.0. That function always uses the built-in library,
 * so we rebuild the prompt here for an extended one.
 * Copyright (c) 2011-2024 Thesys Inc., MIT License. See NOTICE.
 */
const BASE_RULES = [
  "Write every statement on its own top-level line as `name = Expression`. NEVER put a `name = ...` assignment inside an array or inside Root([...]).",
  "Arrays (Root's children, Actions items, Form fields, etc.) contain only references or inline components - never assignments.",
  "Query() and Mutation() must each be their own top-level statement; they cannot appear inside an array or as a nested value.",
  "Statement order: `root = Root([...])` FIRST, then $variable declarations, then each component in the order it appears in the card. The card streams to the user as you write it - blocks render as soon as their statements arrive - so this order makes the UI build top-to-bottom.",
];

const TOOL_RULES = [
  "Reference Query results using the exact field names from each tool's output signature above; do not invent wrapper fields like .items, .nodes, or .rows.",
  "When a Select feeds a Mutation argument that needs an id (e.g. a team or assignee id), make each Option's value that id, not the display name.",
  "Put a form's saving Mutation in the Form's action (4th arg) so one button both fills and submits; do not add a separate submit button.",
];

export type PromptOptions = {
  /** Tool descriptions, so the model can write Query() and Mutation(). */
  tools?: ToolSpec[];
  /** Extra rules appended after OpenUI's own. */
  rules?: string[];
};

/** The system prompt for a library: OpenUI's rules, then tool rules, then the host's rules. */
export function buildPrompt(library: SlackLibrary, opts: PromptOptions = {}): string {
  const hasTools = !!opts.tools?.length;
  const rules = [...BASE_RULES, ...(hasTools ? TOOL_RULES : []), ...(opts.rules ?? [])];
  return library.prompt({ bindings: true, toolCalls: hasTools, tools: opts.tools, additionalRules: rules });
}
