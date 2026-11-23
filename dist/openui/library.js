import { library as slackLibrary } from "@openuidev/channels/slack";
/** OpenUI's Slack library with our changes applied. With no changes, the built-in library. */
export function extendLibrary(changes) {
    if (!changes || (!changes.add?.length && !changes.override?.length && !changes.remove?.length)) {
        return slackLibrary;
    }
    return slackLibrary.extend({ components: changes });
}
//# sourceMappingURL=library.js.map