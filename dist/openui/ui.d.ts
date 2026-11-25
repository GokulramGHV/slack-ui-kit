import type { MessageStore, RenderResult } from "@openuidev/channels";
import type { SlackBlock, SlackTools } from "@openuidev/channels/slack";
import type { SlackLibrary } from "./library.js";
export declare const PLACEHOLDER_TEXT = "Designing your card\u2026";
/**
 * A card that could not be shown. The placeholder message has already been
 * replaced with a short note; `source` is what the model wrote, for debugging.
 */
export declare class CardRenderError extends Error {
    readonly source: string;
    readonly ts: string;
    /** Slack's error code, such as "invalid_blocks", when Slack refused the card. */
    readonly slackError?: string;
    constructor(message: string, opts: {
        source: string;
        ts: string;
        slackError?: string;
        cause?: unknown;
    });
}
export declare const failureText: (code?: string) => string;
export type DeliverArgs = {
    client: any;
    channel: string;
    ts: string;
    result: RenderResult<SlackBlock[]>;
};
export type SlackUIOptions = {
    /** The OpenUI library to render with (see extendLibrary). */
    library: SlackLibrary;
    /** Enables Query()/Mutation() in both the prompt and the renderer. */
    tools?: SlackTools;
    /** Where each card's program and state are saved (default: in memory). */
    store?: MessageStore;
    /** Minimum ms between streamed preview updates (default 500). */
    interval?: number;
    /** Extra rules appended to the system prompt. */
    rules?: string[];
    /** Replace how a finished card is written to its message (default: chat.update). */
    deliver?: (args: DeliverArgs) => Promise<void>;
};
export type StreamedCard = RenderResult<SlackBlock[]> & {
    ts: string;
    source: string;
};
export type SlackUI = {
    prompt: string;
    streamCard(client: any, target: {
        channel: string;
        thread_ts?: string;
    }, textStream: AsyncIterable<string>): Promise<StreamedCard>;
    handleAction(client: any, payload: unknown): Promise<void>;
    handleViewSubmission(client: any, payload: unknown): Promise<void>;
};
/** Strip a Markdown code fence if the model wrapped its program in one. */
export declare function stripFences(s: string): string;
export declare function createSlackUI(opts: SlackUIOptions): SlackUI;
