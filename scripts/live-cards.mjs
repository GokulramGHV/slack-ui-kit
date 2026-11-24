/**
 * The cards the live test posts. Shared with test/live-cards.test.ts, which
 * renders every prefix of each offline so a half-streamed card never throws.
 */
export const renderChecks = (owner) => ({
  plan: `root = Root([p])
p = Plan("Release", [t1, t2, t3, t4])
t1 = TaskCard("Compare", "complete", "3 services checked")
t2 = TaskCard("Build", "in_progress")
t3 = TaskCard("Deploy", "pending")
t4 = TaskCard("Notify", "error", null, "Webhook timed out", [Source("Runbook", "https://example.com/runbook")])`,
  task_card_alone_pending: `root = Root([t])
t = TaskCard("Waiting for review", "pending")`,
  table_numbers_align: `root = Root([t])
t = Table(["Service", "Changes"], [["api", 12], ["web", 3]], ["left", "right"])`,
  data_table: `root = Root([d])
d = DataTable("Services", ["Service", "Changes"], [["api", 12], ["web", 3], ["worker", 1], ["auth", 7]], 2)`,
  card_carousel: `root = Root([c])
c = Carousel([Card("api", "12 changes"), Card("web", "3 changes", [LinkButton("Docs", "https://example.com")])])`,
  container: `root = Root([c])
c = Container("Details", [Section("Hidden until expanded."), Tags([Tag("ready", "green")])], true, true)`,
  layout: `root = Root([l])
l = Layout("Summary", [[Section("*Stage*\\nBuild"), Section("*Services*\\n3")], [Section("*Owner*\\n<@${owner}>")]], true)`,
  tags: `root = Root([t])
t = Tags([Tag("ready", "green"), Tag("skipped", "orange"), Tag("blocked", "red")])`,
  feedback: `root = Root([s, f])
s = Section("A bot answer to rate.")
f = Feedback()`,
  data_table_links: `root = Root([d])
d = DataTable("Links", ["Service", "Docs"], [["api", LinkButton("Docs", "https://example.com/api")], ["web", LinkButton("Docs", "https://example.com/web")]])`,
  card_fields: `root = Root([c])
c = Carousel([Card("api", "12 changes since the last release", [LinkButton("Docs", "https://example.com")], "main branch", "_updated 2h ago_", "https://example.com/icon.png"), Card("web", "3 changes", null, "release-1")])`,
  number_in_actions: `$points = 3
root = Root([a])
a = Actions([n, Button("Go", Action([@Set($points, $points)]))])
n = NumberInput("Points", $points)`,
  search_select: `$people = []
$owner = null
root = Root([Section("Search selects: options load as you type."), a])
a = Actions([SearchSelect("People", $people, "people", true), SearchSelect("Owner", $owner, "people")])`,
  container_draft: `$title = "Fix login"
$done = ""
root = Root([box])
box = Container("Draft ticket", [Section("A full-width draft with its own buttons."), Tags([Tag("bug", "red"), Tag("draft", "gray")]), Context("Drafted from a thread"), row], false, false, "full")
row = Actions([Form("Edit details", "Save", [TextInput("Title", $title)]), Button("Cancel", Action([@Set($done, "cancel")])), Button("Create", Action([@Set($done, "create")]), "primary")])`,
  empty_cells: `root = Root([t, d])
t = Table(["Service", "Note"], [["api", ""], ["web", null], ["worker", "ok"]])
d = DataTable("Empty cells", ["Service", "Note"], [["api", ""], ["web", null], ["worker", "ok"]])`,
});

export const clickCards = () => ({
  card_buttons: `root = Root([h, c])
$picked = ""
h = Section("Card buttons. Owner only. Picked: " + $picked)
c = Carousel([Card("api", "Pick me", [Button("Pick", Action([@Set($picked, "api")]))]), Card("web", "Or me", [Button("Pick", Action([@Set($picked, "web")]))])])`,
  data_table_buttons: `root = Root([h, d])
$row = ""
h = Section("Data table row buttons. Owner only. Row: " + $row)
d = DataTable("Rows", ["Service", "Action"], [["api", Button("Choose", Action([@Set($row, "api")]))], ["web", Button("Choose", Action([@Set($row, "web")]))]])`,
  feedback_anyone: `root = Root([s, f])
s = Section("Feedback: anyone may press, it never locks.")
f = Feedback("Helpful", "Not helpful")`,
  form_with_alert: `root = Root([s, f])
$note = ""
s = Section("Form with an Alert in the modal. Note: " + $note)
f = Form("Add a note", "Save", [Alert("This is a test alert.", "warning"), TextInput("Note", $note)])`,
  alert_levels: `root = Root([s, f])
$note = ""
s = Section("Alert levels: default, info, error, success. Note: " + $note)
f = Form("Alert levels", "Save", [Alert("Default level."), Alert("Info level.", "info"), Alert("Error level.", "error"), Alert("Success level.", "success"), TextInput("Note", $note)])`,
  alert_retry: `root = Root([s, f])
$note = ""
s = Section("Alert retry. The test script makes Slack refuse the first modal; the form should open again without the alert. Note: " + $note)
f = Form("Alert retry", "Save", [Alert("FORCE_REFUSE", "warning"), TextInput("Note", $note)])`,
  refusal_check: `root = Root([s, pick, acts])
$picks = ["api"]
$choice = ""
s = Section("Refusal check. Someone other than the owner clicks first. Choice: " + $choice)
pick = Checkboxes("services", $picks, [Option("api", "api"), Option("web", "web")])
acts = Actions([go])
go = Button("Go", Action([@Set($choice, "go")]), "primary")`,
});

