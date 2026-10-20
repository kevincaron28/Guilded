// Whether this process's startup command registration reached Discord. Discord rejects a server's
// whole command list when one entry is invalid (7.0.0: a /mod description over 100 characters),
// and that failure used to show only in journalctl while /health said everything was fine.
// /health reports this one word, so deploy/update.sh can stop and say so; no server IDs or
// error text leave the bot through it (the developer feed gets those).

export type CommandRegistrationState = "pending" | "ok" | "failed";

export function createCommandRegistrationStatus() {
  let state: CommandRegistrationState = "pending";
  let started = false;
  const failures = new Map<string, string>();
  return {
    start(): void { started = true; failures.clear(); state = "pending"; },
    failed(guildId: string, error: unknown): void {
      failures.set(guildId, error instanceof Error ? error.message : String(error));
      state = "failed";
    },
    finish(): void { if (started && state === "pending") state = "ok"; },
    state(): CommandRegistrationState { return state; },
    failures(): ReadonlyMap<string, string> { return failures; }
  };
}

export const commandRegistration = createCommandRegistrationStatus();
