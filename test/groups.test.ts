import { describe, expect, it } from "vitest";
import { slackGroupResolver } from "../src/groups.js";

function client(impl: (group: string) => Promise<string[]>) {
  const calls: string[] = [];
  return {
    calls,
    usergroups: {
      users: {
        list: async ({ usergroup }: { usergroup: string }) => {
          calls.push(usergroup);
          return { ok: true, users: await impl(usergroup) };
        },
      },
    },
  };
}

describe("slackGroupResolver", () => {
  it("returns a group's members and caches them", async () => {
    const c = client(async () => ["U1", "U2"]);
    const resolve = slackGroupResolver(c);
    expect(await resolve("S1")).toEqual(["U1", "U2"]);
    expect(await resolve("S1")).toEqual(["U1", "U2"]);
    expect(c.calls).toEqual(["S1"]);
  });

  it("asks again once the cache entry is older than the ttl", async () => {
    let t = 0;
    const c = client(async () => ["U1"]);
    const resolve = slackGroupResolver(c, { ttlMs: 1000, now: () => t });
    await resolve("S1");
    t = 1001;
    await resolve("S1");
    expect(c.calls).toEqual(["S1", "S1"]);
  });

  it("does not cache failures", async () => {
    let fail = true;
    const c = client(async () => {
      if (fail) throw new Error("ratelimited");
      return ["U1"];
    });
    const resolve = slackGroupResolver(c);
    await expect(resolve("S1")).rejects.toThrow("ratelimited");
    fail = false;
    expect(await resolve("S1")).toEqual(["U1"]);
  });

  it("gives up after the timeout, but a late answer still fills the cache", async () => {
    let release!: (u: string[]) => void;
    const c = client(() => new Promise((r) => (release = r)));
    const resolve = slackGroupResolver(c, { timeoutMs: 10 });
    await expect(resolve("S1")).rejects.toThrow(/timed out/);
    release(["U1"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(await resolve("S1")).toEqual(["U1"]);
    expect(c.calls).toEqual(["S1"]);
  });
});
