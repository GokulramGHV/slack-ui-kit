import { createEngine } from "@openuidev/channels";
import { slackChannel } from "@openuidev/channels/slack";
import { notificationText, OPENUI_DEFAULT_TEXT } from "../fallback.js";
import { decodePlainText, sanitize } from "../sanitize.js";
import { CardPlacementError, checkLimits, placementChecker } from "./placement.js";
export function createCardEngine(library, opts = {}) {
    const misplaced = opts.strict ? placementChecker(library) : undefined;
    const raw = createEngine({ ...slackChannel, library }, { toolProvider: opts.tools?.provider, quiet: opts.quiet });
    const clean = (r) => {
        const output = sanitize(decodePlainText(r.output));
        if (opts.strict)
            checkLimits(output);
        // Notification text is mrkdwn: build it from the output before plain_text is decoded, so escapes stay.
        const fallbackText = () => notificationText(sanitize(r.output));
        // OpenUI only reads Header and Section for the text; cards of newer blocks would say "OpenUI message".
        const text = r.text && r.text !== OPENUI_DEFAULT_TEXT ? r.text : fallbackText();
        return { ...r, output, text };
    };
    return {
        renderState: async (source, state) => {
            const issues = misplaced?.(source) ?? [];
            if (issues.length)
                throw new CardPlacementError(issues);
            return clean(await raw.renderState(source, state));
        },
        applyInteraction: async (source, state, interaction) => clean(await raw.applyInteraction(source, state, interaction)),
        submitForm: async (source, state, formId, patch) => clean(await raw.submitForm(source, state, formId, patch)),
    };
}
//# sourceMappingURL=engine.js.map