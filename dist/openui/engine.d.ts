import type { Interaction, RenderResult } from "@openuidev/channels";
import type { SlackBlock, SlackTools } from "@openuidev/channels/slack";
import type { SlackLibrary } from "./library.js";
export type Render = RenderResult<SlackBlock[]>;
type State = Record<string, unknown>;
/** OpenUI's engine for a library, with every render cleaned (see sanitize) and given readable text. */
export type CardEngine = {
    renderState(source: string, state?: State): Promise<Render>;
    applyInteraction(source: string, state: State, interaction: Interaction): Promise<Render>;
    submitForm(source: string, state: State, formId: string, patch: State): Promise<Render>;
};
export declare function createCardEngine(library: SlackLibrary, opts?: {
    tools?: SlackTools;
    quiet?: boolean;
}): CardEngine;
export {};
