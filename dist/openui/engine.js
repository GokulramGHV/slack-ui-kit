import { createEngine } from "@openuidev/channels";
import { slackChannel } from "@openuidev/channels/slack";
import { notificationText, OPENUI_DEFAULT_TEXT } from "../fallback.js";
import { sanitize } from "../sanitize.js";
export function createCardEngine(library, opts = {}) {
    const raw = createEngine({ ...slackChannel, library }, { toolProvider: opts.tools?.provider, quiet: opts.quiet });
    const clean = (r) => {
        const output = sanitize(r.output);
        // OpenUI only reads Header and Section for the text; cards of newer blocks would say "OpenUI message".
        const text = r.text && r.text !== OPENUI_DEFAULT_TEXT ? r.text : notificationText(output);
        return { ...r, output, text };
    };
    return {
        renderState: async (source, state) => clean(await raw.renderState(source, state)),
        applyInteraction: async (source, state, interaction) => clean(await raw.applyInteraction(source, state, interaction)),
        submitForm: async (source, state, formId, patch) => clean(await raw.submitForm(source, state, formId, patch)),
    };
}
//# sourceMappingURL=engine.js.map