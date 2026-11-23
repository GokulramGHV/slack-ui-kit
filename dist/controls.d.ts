import type { RenderResult } from "@openuidev/channels";
import type { Block } from "./sanitize.js";
import type { ControlKind } from "./types.js";
/** action id -> what kind of control it is. Saved on the card so clicks are classified without rendering. */
export type Controls = Record<string, ControlKind>;
/**
 * Controls of an OpenUI render. Buttons and inputs come from OpenUI's
 * actionMap (so display-only buttons are left out), forms from its forms, and
 * feedback buttons from the Slack element type in the rendered blocks.
 */
export declare function controlsFromRender(result: Pick<RenderResult<Block[]>, "output" | "actionMap" | "forms">): Controls;
/** Controls of raw blocks the host built, from each element's Slack type. Link buttons are skipped. */
export declare function controlsFromBlocks(blocks: readonly Block[]): Controls;
