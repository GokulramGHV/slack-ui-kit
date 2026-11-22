# slack-ui-kit

Interactive Slack cards that a model writes, with rules for who may click. It
wraps OpenUI's Slack renderer (`@openuidev/channels` 0.1.0) and adds:

- **Click rules.** Owner, a Slack user group, a list of users, or anyone.
  Closed by default: no rule means owner only.
- **Lock on submit.** The first button press freezes the card and shows what
  was chosen, who pressed, and when. A second press gets "This was already
  submitted."
- **Events for the bot.** After an allowed button press, feedback or form
  submit, `onEvent` gets one event.
- **Newer Slack blocks.** Plan, TaskCard, DataTable, Card, Carousel,
  Container, Layout, Feedback, Tags, Alert (in forms), and a Table with numbers
  and alignment. Each one is a plain builder (`blocks.*`) and also an OpenUI
  component.
- **Fixes for OpenUI 0.1.0.** Empty text no longer breaks a card, and a failed
  card replaces "Designing your card…" with a short note.

The kit never owns the Slack connection. You pass in a client (a Bolt client
or `@slack/web-api`'s `WebClient`) and raw Slack payloads.

Name is a placeholder. Local only for now.

## Use

```ts
import { createSlackKit } from "slack-ui-kit";

const kit = createSlackKit({
  store,                              // a CardStore; default: in memory, lost on restart
  onEvent: async (event) => { ... },  // tell the bot what happened
});

// The system prompt for the model. It teaches OpenUI Lang and every component.
const system = kit.prompt;

// A model-written card: posts "Designing your card…", streams previews, then the card.
const { card, ts } = await kit.postCard(client, { channel, threadTs }, textStream, {
  owner: "U123",                     // who asked
  access: { inputs: "anyone" },      // optional; see Rules
  meta: { bot: "release-helper" },   // returned in every event
});

// A template you wrote: OpenUI Lang, posted at once, with trusted control names.
await kit.postCard(client, target, templateSource, { owner, trusted: true, placeholder: false });

// Blocks you posted yourself (buttons only in v1).
await kit.registerCard({ channel, ts, blocks, owner, access });
```

### Wiring clicks (Bolt)

```ts
app.action(/.*/, async ({ ack, body, client }) => {
  await ack();
  const r = await kit.handleAction(client, body);
  if (!r.handled) { /* not a card: pass to your own handlers */ }
});

app.view("openui_form", async ({ ack, body, client }) => {
  const r = await kit.handleViewSubmission(client, body);
  if (!r.handled) return ack();
  await ack(r.response);   // field errors, or undefined to close the form
  await r.done;            // save, redraw, lock and event happen here
});
```

A button that opens a form calls `views.open` before anything else, inside
Slack's 3 seconds.

If your Slack adapter reads `private_metadata` itself, set the form options:

```ts
createSlackKit({
  form: {
    callbackId: "my_cards_form",
    wrapMeta: (m) => JSON.stringify({ m }),
    unwrapMeta: (s) => JSON.parse(s).m,
  },
});
```

## Rules

On a model-written card, control names are whatever the model wrote. So rules
go by **kind of control**, never by name:

```ts
type Rule = "owner" | "anyone" | { group: "S0123" } | { users: ["U1", "U2"] };

access: {
  default?: Rule,      // missing: "owner"
  buttons?: Rule,
  inputs?: Rule,       // checkboxes, selects, pickers
  feedback?: Rule,     // default: "anyone"
  forms?: Rule,        // opening and submitting
  byId?: { [controlId]: Rule },               // trusted cards only
  lock?: "buttons" | "never" | { ids: [...] }, // ids on trusted cards only
}
```

- Anything the kit can't classify is owner only.
- `byId` and lock ids are ignored unless the card is `trusted`, so a renamed
  control can't open itself up.
- A group lookup (`usergroups.users.list`, needs `usergroups:read`) is cached
  for 60 seconds. If it fails or takes longer than 1.5 seconds, the click is
  denied.
- A refused click gets a private note ("Only <@U123> can do this."). A refused
  input change also redraws the card, which undoes the tick on the clicker's
  screen.

## Lock

With `lock: "buttons"` (the default), any action button locks the card.
Link buttons, buttons that open a form, and feedback never lock. A form
submit locks.

- The lock is saved with a version check before any slow work, such as a
  Mutation tool. Two presses at the same moment run the work once.
- If the work after the lock fails, the card stays locked with a note, and the
  bot gets an event with `error`.
- **One press locks the whole card.** On a DataTable or Carousel, pressing a
  row's button locks every row. Use `lock: "never"` for cards meant for
  repeated presses.

Buttons inside Card and DataTable get ids like `el_3`. Their descriptions tell
the model to `@Set` a `$variable` naming the row or card, so the event's
`state` says which one was pressed.

## Events

```ts
type CardEvent = {
  type: "action" | "submit";
  card: { channel; ts; threadTs? };
  user: string;
  control: { id; kind: "button" | "input" | "feedback" | "form"; label?; value? };
  state: Record<string, unknown>;   // the card's state after the click
  locked?: { by; at; label };
  meta?: Record<string, unknown>;   // what you passed in
  error?: string;                   // the work after the lock failed
};
```

Events fire for buttons, feedback and form submits. Pass `events: "all"` to
also get input changes. The event fires even if updating the message in Slack
failed (`updateError` is set on the result). If `onEvent` throws, the kit
throws an `EventDeliveryError` that carries the event, so you can retry.

## Store

```ts
interface CardStore {
  get(channel: string, ts: string): Promise<CardRecord | undefined>;
  // Save only if the stored version still equals expectedVersion (null: insert only if absent).
  put(card: CardRecord, expectedVersion: number | null): Promise<boolean>;
}
```

In SQL, `put` is `UPDATE cards SET ..., version = $new WHERE channel = $1 AND ts = $2 AND version = $expected`,
returning whether a row changed. `MemoryCardStore` is for tests and simple bots.

## Components

| Component | OpenUI Lang | Notes |
| --- | --- | --- |
| Plan | `Plan(title, [TaskCard...])` | up to 50 tasks |
| TaskCard | `TaskCard(title, status, details?, output?, [Source(label, url)]?)` | pending, in_progress, complete, error; alone and pending, it posts as a one-task Plan |
| Table | `Table(headers, rows, align?)` | number cells, `["left", "right"]` |
| DataTable | `DataTable(caption, headers, rows, pageSize?)` | cells: text, number, Button; messages only |
| Card | `Card(title, body?, [Button...]?)` | up to 3 buttons |
| Carousel | `Carousel([Card...])` | 1 to 10 cards |
| Container | `Container(title, [blocks], collapsible?, collapsed?)` | up to 10 display blocks |
| Layout | `Layout(label, [[Section...]], gridLines?)` | 5 rows of 3 |
| Feedback | `Feedback(positive?, negative?)` | anyone, never locks |
| Tags | `Tags([Tag(text, color)])` | 9 colors |
| Alert | `Alert(text, level?)` inside `Form` fields | modals only |

The same blocks without OpenUI: `blocks.plan(...)`, `blocks.taskCard(...)`,
`blocks.table(...)`, `blocks.dataTable(...)`, `blocks.card(...)`, and so on.

Add or replace components with `createSlackKit({ components: { add, override, remove } })`.
A component of yours with the same name as one of the kit's replaces it.
Removing a child (TaskCard, Source, Tag, Alert) leaves its parent unable to
hold it, so remove the parent too (Plan, Tags).

Cards made only of newer blocks still get readable notification text (the
plan title, table caption, card title and so on). OpenUI alone would send
"OpenUI message".

If you call `decide` and `applyDecision` yourself instead of the kit's
handlers, open forms with `formModal(spec, privateMetadata, callbackId)`.
OpenUI's `buildModal` doesn't know about alerts.

### Confirmed in Slack, and not yet

Block shapes come from a live Slack test on 2026-11-22 (saved in
`test/fixtures/accepted-blocks.json`). The kit's own live test
(`npm run live-test`, 2026-11-22) then confirmed:

- Every component renders, including TaskCard `output` and sources, a link
  button on a card, and a Container holding a section and tags.
- Owner clicks on card buttons and data table row buttons, and a form submit,
  each saving state, locking the card and sending one event.
- Alert inside a modal, at every level: default, info, warning, error, success.
- A feedback click: one event with value "positive" or "negative", no lock.
- A TaskCard on its own may not be "pending"; the kit posts it as a one-task Plan.
- A button press from someone other than the owner: refused with a private
  note, no event, no lock.
- A checkbox tick from someone other than the owner: refused with a private
  note, and the tick goes away on their screen. Slack keeps the tick if the
  redraw sends the same blocks, so the kit gives the block holding the input a
  new `block_id` on that redraw.
- The owner's press after that: the card locks and the bot gets one event.
- If Slack refuses a modal with an alert, the kit opens the form again without
  alerts, and Slack accepts the same `trigger_id` the second time.
- Link buttons in data table cells.
- Empty table cells. Slack refuses a cell with empty text, so the kit puts one
  space in it.

Card icon, hero image and subtitle are left out until they are tested.

## Develop

```sh
npm install
npm test           # offline, no Slack token
npm run typecheck
npm run build
npm run live-test  # posts to Slack: only by hand, with permission (Node 22+)
```

`src/openui/ui.ts` and the prompt rules are adapted from OpenUI (MIT). See
`NOTICE`.
