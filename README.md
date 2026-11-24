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

Installed from GitHub release tags (for example `github:GokulramGHV/slack-ui-kit#v0.1.2`); not published to npm.

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

### Starting state

`postCard(..., { state: { title: "Hi" } })` sets the card's starting `$state`,
merged over the defaults the source declares (`$title = ""`). Keys may be
written with or without the `$` (`render(source, state)` takes both too). The
state is saved on the card, so later clicks keep it. Read it back with the `$`:
`card.state.$title`, `event.state.$pick`.

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

### Required answers

`postCard(..., { required: [["pick"], ["reason", "other"]] })` lists groups of
`$state` variable names (with or without `$`). A group is met when at least one of its
variables is non-empty (not null, not blank text, not an empty list). A click
that would lock the card is refused until every group is met, counting the
changes the press itself makes (its `@Set`s, the inputs Slack sent with it, or
a form's submitted values). A refused click saves nothing, fires no event and
runs no tools. The clicker gets a private note (`messages.answerFirst`, default
"Please answer every question first.") and the card is redrawn; a form submit
gets the same text as a field error, and the values typed into the form are saved
on the card, so reopening it shows them again (only for a person who passed the
access check; busy, already-submitted and access-refused submits save nothing). Input changes that don't lock are not
checked. If a press is refused, the inputs it carried (such as text typed
without Enter) are saved on the unlocked card and the redraw keeps them. The
groups are saved on the card as `required`.

### Closing a card

`kit.closeCard(client, channel, ts, { note })` locks an unlocked card without
firing an event: same version-checked save, same locked look (the chosen
summary of the card's current state), with `note` as the footer line instead of
"X pressed by". The note is plain text: the kit escapes it, so data in it
cannot mention anyone. It resolves `true` when it closed the card, `false` when the
card is missing or already locked. Clicks on a closed card are refused like on
any locked card. `card.locked.note` holds the note. If Slack refuses the message
update after the card was locked in the store, `closeCard` throws; the card stays
locked and the next click on it redraws it.

### Entities

Slack shows `plain_text` literally. If you escape data as `&amp;` `&lt;` `&gt;`
(the safe thing in mrkdwn), the kit decodes those three in every `plain_text`
object it renders (button text, options and their descriptions, headers,
labels, placeholders, modal titles), in that order and once, so
`Fish &amp; Chips` shows as `Fish & Chips`, and `control.labels` and
`stateLabels` come back plain. mrkdwn text is left as it is. The lock summary
escapes plain text again for mrkdwn. `registerCard` decodes raw blocks the same
way, but the host posts those blocks itself: do not send entity-escaped
`plain_text` in them, or run them through the exported `decodePlainText` before
posting.

## Events

```ts
type CardEvent = {
  type: "action" | "submit";
  card: { channel; ts; threadTs? };
  user: string;
  control: { id; kind: "button" | "input" | "feedback" | "form"; label?; value?; labels? };
  state: Record<string, unknown>;   // the card's state after the click
  stateLabels?: Record<string, string | string[]>; // shown option text for choices held in state
  locked?: { by; at; label };
  meta?: Record<string, unknown>;   // what you passed in
  error?: string;                   // the work after the lock failed
};
```

`control.labels` holds the text the person saw for the options they chose, read
from the Slack payload (`Record<string, string | string[]>`). On a form submit
it has one entry per choice field (select or multi-select with something
chosen), under the same keys as `control.value`; text, date and other fields get
none. On an input click it is `{ [control.id]: text }` (or a list for
checkboxes). Buttons have no `labels`, and it is left out when nothing is chosen.
Use it to show choices to people, since `value` is only the option's id.

`labels` covers the pressed control and submitted form fields. `stateLabels`
covers the card's state: for every `$state` variable bound to a choice input
(radio, checkboxes, select, multi-select, overflow) it holds the shown option
text for the variable's value after the click, under the same `$` keys as
`state`. So a person who picks "Large" in a radio and then presses Confirm gives
you `state.$size = "l"` and `stateLabels.$size = "Large"`. Values that match no
option are left out, the field is omitted when empty, and cards of raw blocks
(`registerCard`) have no `stateLabels`. The text is as rendered, not unescaped.

Events fire for buttons, feedback and form submits. Pass `events: "all"` to
also get input changes. The event fires even if updating the message in Slack
failed (`updateError` is set on the result). If `onEvent` throws, the kit
throws an `EventDeliveryError` that carries the event, so you can retry.

## Option descriptions

`Option(value, label, description?)`. In `Radio` and `Checkboxes` the
description shows under the label (Slack's option `description`, clipped to 75
characters with an ellipsis; an empty one is left out). `Select`,
`MultiSelect` and `Overflow` ignore it.

## Search dropdowns (options loaded on demand)

`SearchSelect(name, $var, source, multi?)` goes inside `Actions([...])`. Slack
shows a search box and asks the bot for options as the user types, so a list of
thousands costs nothing in the message. `source` is a short word you choose
(`"people"`, `"projects"`) that tells your `loadOptions` what to search.

```ts
const kit = createSlackKit({
  loadOptions: async ({ source, query, card, user }) => {
    if (source === "people") return (await findPeople(query)).map((p) => ({ value: p.id, label: p.name }));
    return [];
  },
});

// Bolt: Slack calls this for every keystroke past min_query_length (1).
app.options(/.*/, async ({ options, ack, client }) => ack(await kit.handleOptions(options, client)));
```

`handleOptions(payload, client?)` takes Slack's `block_suggestion` payload and
returns `{ options: [...] }`: at most 100 options, each label clipped to 75
characters. It applies the same rule as a click on that control (a user who may
not use the card's inputs gets no options, and neither does anyone once the
card is locked). If `loadOptions` is missing or throws, it returns no options
and does not throw. Pass the client if your rules use user groups.

Slack needs an options URL for this:

- Socket Mode: nothing to set. Enable Interactivity and handle the
  `block_suggestion` event (Bolt's `app.options`).
- HTTP: in the Slack app settings under Interactivity & Shortcuts, set the
  **Options Load URL** (it can be the same as the Request URL) and route
  `block_suggestion` payloads to `handleOptions`.

**State holds items, not bare values.** The variable holds `{ value, label }`:
an array when `multi` is true, one item (or `null`) when not. Start it empty
(`$people = []`, `$owner = null`) or with items. Slack's payload carries each
pick's label, so the kit saves both; the next redraw uses the labels as the
dropdown's initial options, and the lock summary shows them. A plain string in
the state is read as an item whose label is its value. `required` counts a
non-empty array or a non-null item. The event's `state` holds the items, and
`stateLabels` has the labels (`{ $people: ["Ana", "Bo"], $owner: "Bo" }`).

Like `TextBox`, changes save into state and send no event unless
`events: "all"`; only buttons and form submits do by default.

## Message size

Slack refuses a message whose blocks are too large (about 10 KB;
`msg_blocks_too_long`). Two static multi-selects of 45 options each pushed a
modest card over. Keep a card well under that:

- Use `SearchSelect` for long option lists instead of `MultiSelect`.
- Put long text in a thread reply, not in the card.
- Only a `Card` is clipped by the kit. Text in other blocks is cut only at Slack's per-field maximums, so a card can still be too large.

## Controls inside a Container

A `Container` may hold an `Actions` row (buttons, a `Form` button, `NumberInput`,
`SearchSelect`), so a draft can carry its own buttons:

```
box = Container("Draft", [Section("..."), Tags([...]), Context("..."), row], false, false, "full")
row = Actions([Form("Edit details", "Save", [...]), Button("Cancel", ...), Button("Create", ..., "primary")])
```

Access, lock and `required` work as at top level: a click inside the container
is found like any other, a lock replaces the controls inside it with what was
chosen, and a refused change redraws the inputs in it.

## A component that would vanish

Some components draw nothing on their own, or sit where the parent skips them.
Rather than post a card with the control silently missing, `postCard` and
`render` throw a `CardRenderError` that names the component and where it is, for
example `SearchSelect is not allowed in Root.children (at Root.children[1]);
Root.children accepts only Header, Section, ...`. Nothing is posted (with a
placeholder, it is replaced by the short failure note). The cases:

- `NumberInput`, `SearchSelect`, `TextInput` and the other parts that render
  nothing alone (`Option`, `Source`, `Tag`, `Alert`, ...) under a parent that does not list them.
  `NumberInput` and `SearchSelect` belong in `Actions` (`NumberInput` also in `Form`).
- Anything in `Actions.items`, `Form.fields` or `Section.accessory` that the slot
  does not list, such as a `Radio` in a `Form`. (A `Form` is listed in `Actions.items`.)

Other OpenUI warnings (an unknown component, extra arguments, a bare input in
`Root`) are still just warnings. An item chosen by a condition
(`$x ? Form(...) : Button(...)`) is not checked, and `Plan.tasks` is not checked.
Note that `kit.engine.renderState` is strict too.

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
| Card | `Card(title, body?, [Button...]?, subtitle?, subtext?, icon?)` | up to 3 buttons; `icon` is an http(s) image URL (anything else is left out); title and subtitle clip at 150 characters, body and subtext at 200, and a clip never splits a `<@U…>` mention, a `<link|label>` or a `:emoji:` |
| Actions | `Actions([Button, Form, NumberInput, SearchSelect, ...])` | one row in the order written. A `Form` in the row puts its open-form button there, so a row can be `[Edit details, Cancel, Create]`; the form still opens its modal on click. `NumberInput` and `SearchSelect` get their own input block after the row |
| NumberInput | `NumberInput(label, $var)` in `Form` or in `Actions([...])` | in `Actions` it is its own input block that saves when the user presses Enter; whole numbers; state holds a number, or null when cleared |
| SearchSelect | `SearchSelect(name, $var, source, multi?)` in `Actions([...])` | options load as the user types, see below |
| Carousel | `Carousel([Card...])` | 1 to 10 cards |
| Container | `Container(title, [blocks], collapsible?, collapsed?, width?)` | up to 10 blocks: Header, Section, Fields, Context, Divider, Image, Markdown, RichText, Table, Tags and an `Actions` row; `width` is `"narrow"`, `"standard"`, `"wide"` or `"full"` (left out when unset) |
| Layout | `Layout(label, [[Section...]], gridLines?)` | 5 rows of 3 |
| Feedback | `Feedback(positive?, negative?)` | anyone, never locks |
| Tags | `Tags([Tag(text, color)])` | 9 colors |
| Form | `Form(title, submit, [fields], action?, optional?)` | a button that opens a modal. Every field is required to submit, except those named in `optional`, a list of $variable names without the `$` (`null` for `action` when there is none). A `Select` or `MultiSelect` with no options is left out of the modal, not shown as a text box |
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

Card `subtitle`, `subtext` and `icon`, a `number_input` and a
`multi_external_select` in an input block with `dispatch_action` on a message
were accepted by Slack in a later live test. The card hero image is left out
until it is tested.

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
