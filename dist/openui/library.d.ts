import type { RenderFn } from "@openuidev/channels";
import { library as slackLibrary } from "@openuidev/channels/slack";
/** The OpenUI Slack library type, built-in or extended. */
export type SlackLibrary = typeof slackLibrary;
type Component = Parameters<SlackLibrary["extend"]>[0] extends {
    components?: infer C;
} ? C : never;
/**
 * Components to add to or replace in OpenUI's Slack library.
 * `add` entries with `slots` join those parents ("Root", or "Parent.prop");
 * entries without slots are only reachable as another component's child.
 */
export type ComponentChanges = NonNullable<Component>;
/** OpenUI's Slack library with our changes applied. With no changes, the built-in library. */
export declare function extendLibrary(changes?: ComponentChanges): SlackLibrary;
export type { RenderFn };
