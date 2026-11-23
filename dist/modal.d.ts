import type { FormSpec } from "./types.js";
/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, cleaned and capped for a modal.
 */
export declare function formModal(spec: FormSpec, privateMetadata: string, callbackId: string): Record<string, any>;
