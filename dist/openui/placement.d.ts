import type { Block } from "../sanitize.js";
import type { SlackLibrary } from "./library.js";
export type Misplaced = {
    /** The component that is out of place, such as "Form". */
    component: string;
    /** The component that holds it and the prop it sits in, such as "Actions.items". */
    slot: string;
    /** Where it is, from the root: "Root.children[0] > Actions.items[1]". */
    where: string;
    /** The component names the slot accepts. */
    allowed: string[];
};
/** A card source that puts a component where it is not allowed. `issues` lists each one. */
export declare class CardPlacementError extends Error {
    readonly issues: Misplaced[];
    constructor(issues: Misplaced[]);
}
/** A card with more than Slack takes in one block (container children, card buttons); the tail (often its buttons) would be cut. */
export declare class CardLimitError extends Error {
    constructor(message: string);
}
/** Throws CardLimitError when a container has more than 10 children or a card more than 3 buttons. Run on cleaned blocks. */
export declare function checkLimits(blocks: readonly Block[]): void;
export declare function placementChecker(library: SlackLibrary): (source: string) => Misplaced[];
