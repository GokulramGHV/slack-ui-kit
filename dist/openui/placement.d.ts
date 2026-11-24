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
export declare function placementChecker(library: SlackLibrary): (source: string) => Misplaced[];
