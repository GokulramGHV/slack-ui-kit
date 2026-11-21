import type { GroupResolver } from "./access.js";

/** The one Slack method the group resolver needs (scope: usergroups:read). */
export type GroupClient = {
  usergroups: { users: { list(args: { usergroup: string }): Promise<{ users?: string[] }> } };
};

export type GroupResolverOptions = {
  /** How long a group's members are trusted (default 60 s). */
  ttlMs?: number;
  /** Longest wait for Slack (default 1.5 s), so a form can still open within 3 s. */
  timeoutMs?: number;
  now?: () => number;
};

/**
 * Resolves Slack user groups with a cache. Failures are not cached. A lookup
 * that times out still fills the cache when Slack answers, for the next click.
 */
export function slackGroupResolver(client: GroupClient, opts: GroupResolverOptions = {}): GroupResolver {
  const ttl = opts.ttlMs ?? 60_000;
  const timeout = opts.timeoutMs ?? 1_500;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { users: string[]; at: number }>();
  const inflight = new Map<string, Promise<string[]>>();

  const fetch = (id: string) => {
    let p = inflight.get(id);
    if (!p) {
      p = client.usergroups.users
        .list({ usergroup: id })
        .then((r) => {
          const users = r.users ?? [];
          cache.set(id, { users, at: now() });
          return users;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return p;
  };

  return async (id) => {
    const hit = cache.get(id);
    if (hit && now() - hit.at <= ttl) return hit.users;
    const pending = fetch(id);
    pending.catch(() => {}); // a late failure after a timeout must not go unhandled
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Slack user group lookup timed out (${id})`)), timeout);
    });
    try {
      return await Promise.race([pending, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
}
