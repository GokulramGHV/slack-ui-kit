import type { ToolSpec } from "@openuidev/lang-core";
import type { SlackLibrary } from "./library.js";
export type PromptOptions = {
    /** Tool descriptions, so the model can write Query() and Mutation(). */
    tools?: ToolSpec[];
    /** Extra rules appended after OpenUI's own. */
    rules?: string[];
};
/** The system prompt for a library: OpenUI's rules, then tool rules, then the host's rules. */
export declare function buildPrompt(library: SlackLibrary, opts?: PromptOptions): string;
