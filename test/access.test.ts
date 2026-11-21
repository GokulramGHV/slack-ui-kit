import { describe, expect, it } from "vitest";
import { isAllowed, refusalText, ruleFor } from "../src/access.js";
import type { Access } from "../src/types.js";

const card = (access: Access, trusted = false) => ({ access, trusted, owner: "U1" });

describe("ruleFor", () => {
  it("is owner only when nothing is set", () => {
    expect(ruleFor(card({}), { id: "go", kind: "button" })).toBe("owner");
    expect(ruleFor(card({}), { id: "pick", kind: "input" })).toBe("owner");
    expect(ruleFor(card({}), { id: "form:f", kind: "form" })).toBe("owner");
  });

  it("is anyone for feedback unless the host says otherwise", () => {
    expect(ruleFor(card({ default: { group: "S1" } }), { id: "fb", kind: "feedback" })).toBe("anyone");
    expect(ruleFor(card({ feedback: "owner" }), { id: "fb", kind: "feedback" })).toBe("owner");
  });

  it("uses the rule for the control's kind, then the card default", () => {
    const access: Access = { default: "anyone", buttons: { group: "S1" }, forms: { users: ["U9"] } };
    expect(ruleFor(card(access), { id: "go", kind: "button" })).toEqual({ group: "S1" });
    expect(ruleFor(card(access), { id: "pick", kind: "input" })).toBe("anyone");
    expect(ruleFor(card(access), { id: "form:f", kind: "form" })).toEqual({ users: ["U9"] });
  });

  it("honours byId only on trusted cards", () => {
    const access: Access = { buttons: "owner", byId: { go: "anyone" } };
    expect(ruleFor(card(access, true), { id: "go", kind: "button" })).toBe("anyone");
    expect(ruleFor(card(access, false), { id: "go", kind: "button" })).toBe("owner");
  });

  it("is owner only for a control it can't classify, even with an open default", () => {
    expect(ruleFor(card({ default: "anyone" }), { id: "x", kind: undefined })).toBe("owner");
  });
});

describe("isAllowed", () => {
  const groups = async (id: string) => (id === "S1" ? ["U2", "U3"] : []);
  it("checks owner, anyone, user lists and groups", async () => {
    expect(await isAllowed("owner", "U1", "U1", groups)).toBe(true);
    expect(await isAllowed("owner", "U2", "U1", groups)).toBe(false);
    expect(await isAllowed("anyone", "U7", "U1", groups)).toBe(true);
    expect(await isAllowed({ users: ["U5"] }, "U5", "U1", groups)).toBe(true);
    expect(await isAllowed({ users: ["U5"] }, "U1", "U1", groups)).toBe(false);
    expect(await isAllowed({ group: "S1" }, "U3", "U1", groups)).toBe(true);
    expect(await isAllowed({ group: "S1" }, "U1", "U1", groups)).toBe(false);
  });

  it("denies when the group lookup fails", async () => {
    const failing = async () => {
      throw new Error("missing_scope");
    };
    expect(await isAllowed({ group: "S1" }, "U2", "U1", failing)).toBe(false);
  });

  it("denies a group rule when no resolver is set", async () => {
    expect(await isAllowed({ group: "S1" }, "U2", "U1", undefined)).toBe(false);
  });
});

describe("refusalText", () => {
  it("names who may act", () => {
    expect(refusalText("owner", "U1")).toBe("Only <@U1> can do this.");
    expect(refusalText({ group: "S1" }, "U1")).toBe("Only people in <!subteam^S1> can do this.");
    expect(refusalText({ users: ["U5", "U6"] }, "U1")).toBe("Only <@U5> or <@U6> can do this.");
  });
});
