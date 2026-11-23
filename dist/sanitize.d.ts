/**
 * Make blocks safe to send. Slack rejects a whole message (invalid_blocks)
 * when any text object has empty text, and OpenUI 0.1.0 passes those through,
 * e.g. Section($note) while $note is still "".
 */
export type Block = Record<string, any>;
export type Surface = "message" | "modal";
/** Slack's block limits: 50 in a message, 100 in a modal or Home tab. */
export declare const BLOCK_LIMITS: Record<Surface, number>;
/** True for a mrkdwn or plain_text object whose text is empty or only spaces. */
export declare const isEmptyText: (o: any) => boolean;
/** Drop empty text objects (and blocks left empty), then cap at the surface's block limit. */
export declare function sanitize(blocks: readonly Block[], surface?: Surface): Block[];
