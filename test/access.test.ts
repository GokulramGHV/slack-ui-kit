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

describe("stateUser rule", () => {
  const rule = { stateUser: "assignee" };
  const state = { $assignee: "U2ABC" };

  it("allows only the user named in the state", async () => {
    expect(await isAllowed(rule, "U2ABC", "U1", undefined, state)).toBe(true);
    expect(await isAllowed(rule, "U3", "U1", undefined, state)).toBe(false);
  });

  it("refuses the card owner too", async () => {
    expect(await isAllowed(rule, "U1", "U1", undefined, state)).toBe(false);
  });

  it("accepts the key written with a dollar sign", async () => {
    expect(await isAllowed({ stateUser: "$assignee" }, "U2ABC", "U1", undefined, state)).toBe(true);
  });

  it("allows nobody when the value is missing, empty or malformed", async () => {
    for (const bad of [undefined, "", "u2abc", "U2", "X123", "U2 ABC", 5, null, ["U2ABC"], { id: "U2ABC" }]) {
      const st = bad === undefined ? {} : { $assignee: bad };
      expect(await isAllowed(rule, "U2ABC", "U1", undefined, st)).toBe(false);
      expect(await isAllowed(rule, "U1", "U1", undefined, st)).toBe(false);
    }
    expect(await isAllowed(rule, "U2ABC", "U1", undefined)).toBe(false);
  });

  it("names the stored id in the refusal, or says nobody can yet", () => {
    expect(refusalText(rule, "U1", state)).toBe("Only <@U2ABC> can do this.");
    expect(refusalText(rule, "U1", { $assignee: "nope" })).toBe("Nobody can do this yet.");
    expect(refusalText(rule, "U1")).toBe("Nobody can do this yet.");
  });

  it("leaves the existing rule forms unchanged", async () => {
    expect(await isAllowed("owner", "U1", "U1", undefined, state)).toBe(true);
    expect(await isAllowed("owner", "U2ABC", "U1", undefined, state)).toBe(false);
    expect(await isAllowed("anyone", "U9", "U1", undefined, state)).toBe(true);
    expect(await isAllowed({ users: ["U5"] }, "U5", "U1", undefined, state)).toBe(true);
    expect(await isAllowed({ group: "S1" }, "U2", "U1", async () => ["U2"], state)).toBe(true);
    expect(refusalText({ users: ["U5"] }, "U1", state)).toBe("Only <@U5> can do this.");
  });
});

describe("stateUser guards", () => {
  it("is honoured only on trusted cards, from any slot", () => {
    const rule = { stateUser: "assignee" };
    for (const access of [{ default: rule }, { buttons: rule }, { inputs: rule }, { forms: rule }, { feedback: rule }] as Access[]) {
      const untrusted = ruleFor(card(access), { id: "x", kind: "button" });
      expect(untrusted).not.toEqual(rule);
    }
    expect(ruleFor(card({ buttons: rule }, true), { id: "x", kind: "button" })).toEqual(rule);
    expect(ruleFor(card({ feedback: rule }), { id: "x", kind: "feedback" })).toEqual({ users: [] });
  });

  it("denies instead of throwing on a non-string key", async () => {
    const bad = { stateUser: 5 } as any;
    expect(await isAllowed(bad, "U1", "U1", undefined, { $5: "U1" })).toBe(false);
    expect(refusalText(bad, "U1", {})).toBe("Nobody can do this yet.");
  });
});
