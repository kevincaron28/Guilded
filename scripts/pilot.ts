// Owner-only local administration. Never starts a Discord client or prints credentials.
import { readFile, writeFile, rename, rm, stat, chown } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { editPilotApprovals, pilotFilePolicy, pilotInvite } from "../src/services/pilot-admin.js";

const [action = "status", guildId] = process.argv.slice(2);
const path = ".env.local";
try {
  let source = await readFile(path, "utf8");
  if (["enable", "approve", "revoke"].includes(action)) {
    const next = editPilotApprovals(source, action as "enable" | "approve" | "revoke", guildId);
    const temp = `${path}.pilot-${randomUUID()}.tmp`;
    try {
      const info = await stat(path);
      await writeFile(temp, next, { flag: "wx", mode: info.mode & 0o777 });
      if (process.platform !== "win32") await chown(temp, info.uid, info.gid);
      // Do not overwrite an owner's edit that happened while preparing this update.
      if (await readFile(path, "utf8") !== source) throw new Error("Configuration changed; retry the command.");
      await rename(temp, path);
    } finally { await rm(temp, { force: true }); }
    source = next;
    console.log("Saved pilot approvals. Restart the existing server service before using an invite. Do not start a second bot.");
  } else if (!["status", "invite"].includes(action)) throw new Error("Use: npm run pilot -- status | enable | approve SERVER_ID | revoke SERVER_ID | invite SERVER_ID");
  const policy = pilotFilePolicy(source);
  console.log(`Hosted pilot: ${policy.enabled ? "enabled" : "disabled"}. Approved servers: ${policy.guildIds.join(", ")}`);
  if (action === "invite") console.log(pilotInvite(source, guildId ?? ""));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Pilot configuration could not be updated.");
  process.exitCode = 1;
}
