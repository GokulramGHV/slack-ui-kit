import { describe, expect, it } from "vitest";
import { notificationText } from "../src/fallback.js";
import { createSlackKit } from "../src/kit.js";

describe("notificationText", () => {
  it("uses the first readable title in the blocks, including the newer blocks", () => {
    expect(notificationText([{ type: "plan", title: "Release", tasks: [] }])).toBe("Release");
    expect(notificationText([{ type: "data_table", caption: "Services", rows: [] }])).toBe("Services");
    expect(notificationText([{ type: "carousel", elements: [{ type: "card", title: { type: "mrkdwn", text: "api" } }] }])).toBe("api");
    expect(notificationText([{ type: "container", title: { type: "plain_text", text: "Details" }, child_blocks: [] }])).toBe("Details");
    expect(notificationText([{ type: "layout", label: "Summary", rows: [] }])).toBe("Summary");
    expect(notificationText([{ type: "task_card", task_id: "t1", title: "Build", status: "complete" }])).toBe("Build");
    expect(notificationText([{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "tag", text: "ready" }, { type: "text", text: " " }, { type: "tag", text: "done" }] }] }])).toBe("ready done");
  });

  it("falls back to a plain word when nothing is readable", () => {
    expect(notificationText([{ type: "divider" }])).toBe("Card");
  });
});

describe("card text", () => {
  it("replaces OpenUI's 'OpenUI message' for cards made only of the newer blocks", async () => {
    const kit = createSlackKit({ quiet: true });
    expect((await kit.render('root = Root([p])\np = Plan("Release", [TaskCard("Build", "complete")])')).text).toBe("Release");
    expect((await kit.render('root = Root([h])\nh = Header("Hello")')).text).toBe("Hello");
  });

  it("gives a registered card text from its blocks when the host gives none", async () => {
    const kit = createSlackKit();
    const card = await kit.registerCard({ channel: "C1", ts: "1.1", owner: "U1", blocks: [{ type: "section", text: { type: "mrkdwn", text: "Release ready." } }] });
    expect(card.text).toBe("Release ready.");
  });
});
