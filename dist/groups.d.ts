import type { GroupResolver } from "./access.js";
/** The one Slack method the group resolver needs (scope: usergroups:read). */
export type GroupClient = {
    usergroups: {
        users: {
            list(args: {
                usergroup: string;
            }): Promise<{
                users?: string[];
            }>;
        };
    };
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
export declare function slackGroupResolver(client: GroupClient, opts?: GroupResolverOptions): GroupResolver;
