import type { FormSpec } from "./types.js";
/**
 * The modal a form opens: OpenUI's modal, with any Alert notices put back in
 * their places among the fields, fields named in `optional` marked optional,
 * dropdowns with no options left out, cleaned and capped for a modal.
 */
export declare function formModal(spec: FormSpec, privateMetadata: string, callbackId: string): Record<string, any>;
