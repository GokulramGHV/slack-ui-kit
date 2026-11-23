// Public entry point. Most hosts need only createSlackKit; the pure pieces
// (decide, applyDecision, sanitize, the block builders) are exported too.
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
export { blocks, LIMITS, richText, type Source, type TaskInput, type TaskStatus } from "./blocks.js";
export * as components from "./components.js";
export { formModal } from "./modal.js";
export { notificationText } from "./fallback.js";
export { decodePlainText, decodeEntities } from "./sanitize.js";
export type { FormNotice } from "./components.js";
