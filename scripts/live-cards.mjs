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
});

