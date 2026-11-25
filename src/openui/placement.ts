/**
 * Finds components placed where the library does not accept them and the parent would drop them, such
 * as a Form inside Actions.
 * OpenUI keeps such a component in its parse tree but its parent drops it when drawing, so without
 * this check the card posts with the control silently missing.
 */
import { createParser } from "@openuidev/lang-core";
import { LIMITS } from "../blocks.js";
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
export class CardPlacementError extends Error {
  readonly issues: Misplaced[];
  constructor(issues: Misplaced[]) {
    super(
      issues
        .map((i) => `${i.component} is not allowed in ${i.slot} (at ${i.where}); ${i.slot} accepts only ${i.allowed.join(", ")}`)
        .join("; "),
    );
    this.name = "CardPlacementError";
    this.issues = issues;
  }
}

/** A card with more than Slack takes in one block (container children, card buttons); the tail (often its buttons) would be cut. */
export class CardLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardLimitError";
  }
}

/** Throws CardLimitError when a container has more than 10 children or a card more than 3 buttons. Run on cleaned blocks. */
export function checkLimits(blocks: readonly Block[]): void {
  for (const b of blocks) {
    if (b.type === "container") {
      const kids: Block[] = b.child_blocks ?? [];
      if (kids.length > LIMITS.containerChildren) {
        throw new CardLimitError(
          `Container "${b.title?.text ?? ""}" has ${kids.length} children but Slack allows at most ${LIMITS.containerChildren}; the children past ${LIMITS.containerChildren} (such as an Actions row of buttons) would be dropped. Shorten the list or split it across Containers.`,
        );
      }
      checkLimits(kids);
    } else if (b.type === "carousel") {
      checkLimits(b.elements ?? []);
    } else if (b.type === "card" && (b.actions?.length ?? 0) > LIMITS.cardActions) {
      const title = String(b.title?.text ?? "");
      throw new CardLimitError(
        `Card ${title ? `"${title}" ` : ""}has ${b.actions.length} buttons but Slack allows at most ${LIMITS.cardActions}; the buttons past ${LIMITS.cardActions} would be dropped. Remove some buttons or split them across Cards.`,
      );
    }
  }
}

const isElement = (n: any) => !!n && typeof n === "object" && n.type === "element" && typeof n.typeName === "string";

const refName = (s: any): string | undefined => (typeof s?.$ref === "string" ? s.$ref.split("/").pop() : undefined);

/** Component names a slot accepts directly (a $ref, or a union that includes some). */
function refsOf(s: any): string[] {
  if (!s || typeof s !== "object") return [];
  const own = refName(s);
  if (own) return [own];
  return [...(s.anyOf ?? []), ...(s.oneOf ?? [])].flatMap(refsOf);
}

/** The schema of a list slot's items, looking through a union with null. */
function itemsOf(s: any): any {
  if (!s || typeof s !== "object") return undefined;
  if (s.type === "array" || (Array.isArray(s.type) && s.type.includes("array"))) return s.items;
  for (const o of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) {
    const i = itemsOf(o);
    if (i) return i;
  }
  return undefined;
}

/**
 * The slots whose parent draws only the components it accepts and silently skips the rest. Other
 * parents (Root, Container, Carousel, ...) draw whatever they hold, so a mismatch there is not a drop.
 */
const DROPS: ReadonlySet<string> = new Set(["Actions.items", "Form.fields", "Section.accessory"]);

/**
 * Components that draw nothing themselves: a parent reads them as data (Option, Source, Tag, Alert,
 * form fields) or draws them in its own way (NumberInput and SearchSelect, inside Actions). Under a
 * parent that does not list them, they vanish, whichever parent it is.
 */
const NO_OUTPUT: ReadonlySet<string> = new Set([
  "NumberInput", "SearchSelect", "TextInput", "TextArea", "EmailInput", "URLInput",
  "Option", "Source", "Tag", "Alert", "Field", "Para", "Quote", "Code", "List",
]);

export function placementChecker(library: SlackLibrary) {
  const schema: any = library.toJSONSchema();
  const defs: Record<string, any> = schema.$defs ?? {};
  const parser = createParser(schema, library.root ?? "Root");

  return function find(source: string): Misplaced[] {
    const issues: Misplaced[] = [];
    let root: any;
    try {
      root = parser.parse(source).root;
    } catch {
      return issues; // the engine reports unparsable text its own way
    }
    const seen = new Set<unknown>();

    const visit = (value: any, slot: any, parent: string, prop: string, where: string) => {
      if (isElement(value)) {
        const allowed = refsOf(slot);
        if ((DROPS.has(`${parent}.${prop}`) || NO_OUTPUT.has(value.typeName)) && allowed.length && !allowed.includes(value.typeName) && defs[value.typeName]) {
          issues.push({ component: value.typeName, slot: `${parent}.${prop}`, where, allowed });
          return; // what is inside a misplaced component is not drawn either
        }
        check(value, where);
      } else if (Array.isArray(value)) {
        const item = itemsOf(slot);
        value.forEach((v, i) => visit(v, item ?? slot, parent, prop, `${where}[${i}]`));
      }
    };

    const check = (node: any, where: string) => {
      if (seen.has(node)) return;
      seen.add(node);
      const props = defs[node.typeName]?.properties;
      if (!props) return;
      for (const [prop, value] of Object.entries<any>(node.props ?? {})) {
        if (value && typeof value === "object" && props[prop]) {
          const at = `${node.typeName}.${prop}`;
          visit(value, props[prop], node.typeName, prop, where === "" ? at : `${where} > ${at}`);
        }
      }
    };

    if (isElement(root)) check(root, "");
    return issues;
  };
}
