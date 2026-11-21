// Public entry point. Step 1 exposes the OpenUI layer; rules, lock, store and
// the kit factory come in later steps (see the design doc).
export {
  buildPrompt,
  createSlackUI,
  extendLibrary,
  type ComponentChanges,
  type DeliverArgs,
  type PromptOptions,
  type SlackLibrary,
  type SlackUI,
  type SlackUIOptions,
  type StreamedCard,
} from "./openui/index.js";
export { CardRenderError } from "./openui/index.js";
export { BLOCK_LIMITS, isEmptyText, sanitize, type Block, type Surface } from "./sanitize.js";
export { MemoryCardStore } from "./store.js";
export type { Access, CardEvent, CardRecord, CardStore, ControlKind, LockInfo, Rule } from "./types.js";
export {
  createSlackKit,
  EventDeliveryError,
  type ActionResult,
  type FormMeta,
  type PostOptions,
  type PostTarget,
  type SlackClient,
  type SlackKit,
  type SlackKitOptions,
  type SubmissionResult,
} from "./kit.js";
export { decide, clickFromAction, clickFromSubmission, type Click, type Decision, type DecideContext } from "./decide.js";
export { applyDecision, newOpenUICard } from "./apply.js";
export { isAllowed, refusalText, ruleFor, type GroupResolver } from "./access.js";
export { slackGroupResolver, type GroupResolverOptions } from "./groups.js";
export { controlsFromBlocks, controlsFromRender, type Controls } from "./controls.js";
export { lockedBlocks, dateToken } from "./lock.js";
export { createCardEngine, type CardEngine } from "./openui/index.js";
export type { FormSpec } from "./types.js";
