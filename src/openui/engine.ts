import { createEngine } from "@openuidev/channels";
import type { Interaction, RenderResult } from "@openuidev/channels";
import { slackChannel } from "@openuidev/channels/slack";
import type { SlackBlock, SlackTools } from "@openuidev/channels/slack";
import { sanitize } from "../sanitize.js";
import type { SlackLibrary } from "./library.js";

export type Render = RenderResult<SlackBlock[]>;
type State = Record<string, unknown>;

/** OpenUI's engine for a library, with every render cleaned (see sanitize). */
export type CardEngine = {
  renderState(source: string, state?: State): Promise<Render>;
  applyInteraction(source: string, state: State, interaction: Interaction): Promise<Render>;
  submitForm(source: string, state: State, formId: string, patch: State): Promise<Render>;
};

export function createCardEngine(library: SlackLibrary, opts: { tools?: SlackTools; quiet?: boolean } = {}): CardEngine {
  const raw = createEngine({ ...slackChannel, library }, { toolProvider: opts.tools?.provider, quiet: opts.quiet });
  const clean = (r: Render): Render => ({ ...r, output: sanitize(r.output) });
  return {
    renderState: async (source, state) => clean(await raw.renderState(source, state)),
    applyInteraction: async (source, state, interaction) => clean(await raw.applyInteraction(source, state, interaction)),
    submitForm: async (source, state, formId, patch) => clean(await raw.submitForm(source, state, formId, patch)),
  };
}
