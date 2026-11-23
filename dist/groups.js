/**
 * Resolves Slack user groups with a cache. Failures are not cached. A lookup
 * that times out still fills the cache when Slack answers, for the next click.
 */
export function slackGroupResolver(client, opts = {}) {
    const ttl = opts.ttlMs ?? 60_000;
    const timeout = opts.timeoutMs ?? 1_500;
    const now = opts.now ?? Date.now;
    const cache = new Map();
    const inflight = new Map();
    const fetch = (id) => {
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
        if (hit && now() - hit.at <= ttl)
            return hit.users;
        const pending = fetch(id);
        pending.catch(() => { }); // a late failure after a timeout must not go unhandled
        let timer;
        const timedOut = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Slack user group lookup timed out (${id})`)), timeout);
        });
        try {
            return await Promise.race([pending, timedOut]);
        }
        finally {
            clearTimeout(timer);
        }
    };
}
//# sourceMappingURL=groups.js.map