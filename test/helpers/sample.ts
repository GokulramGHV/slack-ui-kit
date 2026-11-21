/** A generic card that uses inputs, buttons and a form. */
export const SAMPLE_CARD = `root = Root([hdr, intro, pick, acts, note])
$picks = ["alpha"]
$decision = ""
$comment = ""
hdr = Header("Pick items")
intro = Section("Choose the items to include.")
pick = Checkboxes("items", $picks, [Option("alpha", "Alpha"), Option("beta", "Beta")])
acts = Actions([go, stop])
go = Button("Go", Action([@Set($decision, "go")]), "primary")
stop = Button("Stop", Action([@Set($decision, "stop")]), "danger")
note = Form("Add a note", "Save", [TextInput("Note", $comment)])`;
