/** A Slack client stand-in that records every call and returns fixed message ids. */
export type Call = { method: string; args: any };

export function fakeClient() {
  const calls: Call[] = [];
  let n = 0;
  const record = (method: string, result: (args: any) => any = () => ({ ok: true })) =>
    async (args: any) => {
      calls.push({ method, args: structuredClone(args) });
      return result(args);
    };
  return {
    calls,
    chat: {
      postMessage: record("chat.postMessage", () => ({ ok: true, ts: `1700000000.${String(++n).padStart(6, "0")}` })),
      update: record("chat.update"),
      delete: record("chat.delete"),
      postEphemeral: record("chat.postEphemeral"),
    },
    views: { open: record("views.open") },
  };
}

export async function* once(text: string) {
  yield text;
}
