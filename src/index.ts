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
