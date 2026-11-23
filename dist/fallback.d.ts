import type { Block } from "./sanitize.js";
/** What OpenUI 0.1.0 uses as a card's text when it finds no Header or Section. */
export declare const OPENUI_DEFAULT_TEXT = "OpenUI message";
/** Notification text for a card: the first readable title in its blocks. */
export declare function notificationText(blocks: readonly Block[]): string;
