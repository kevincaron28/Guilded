import { mkdir, readFile, rename, rm, stat, writeFile, chown } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type ButtonInteraction, type Client, type Guild } from "discord.js";
import { editPilotApprovals, pilotFilePolicy, pilotInvite } from "./pilot-admin.js";

export const PILOT_REQUEST_PREFIX = "pilot-request:";
type Request = { nonce: string; name: string; status: "pending" | "blocked" | "approved"; messageId?: string };
type State = Record<string, Request>;
type Options = { enabled: boolean; allows: (id: string) => boolean; replace: (ids: string[]) => void;
  activate: (guild: Guild) => Promise<void>; envPath?: string; statePath?: string };

// Local state avoids waking Postgres for admission checks and survives normal deploys.
// Only this single bot process handles decisions; the CLI remains an emergency override.
export function createPilotRequests(client: Client, options: Options) {
  const envPath = options.envPath ?? ".env.local", statePath = options.statePath ?? "backups/pilot-requests.json";
  let ownerId: string | undefined, queue = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const task = queue.then(fn); queue = task.then(() => undefined, () => undefined); return task;
  };
  const owner = async () => {
    if (!ownerId) {
      const app = await client.application!.fetch();
      ownerId = app.owner && ("ownerId" in app.owner ? app.owner.ownerId : app.owner.id) || undefined;
      if (!ownerId) throw new Error("Cannot resolve the Discord application owner for pilot approvals.");
    }
    return ownerId;
  };
  const load = async (): Promise<State> => {
    try { return JSON.parse(await readFile(statePath, "utf8")) as State; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  };
  const save = async (state: State) => {
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    const temp = `${statePath}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await rename(temp, statePath); }
    finally { await rm(temp, { force: true }); }
  };
  return {
    request(guild: Guild) { return serial(async () => {
      if (!options.enabled || options.allows(guild.id)) return;
      const state = await load();
      if (state[guild.id]?.status === "blocked") { await guild.leave(); return; }
      let request = state[guild.id];
      if (request?.status === "pending" && request.messageId) return;
      if (!request || request.status !== "pending") {
        if (Object.values(state).filter(row => row.status === "pending").length >= 100) { await guild.leave(); return; }
        request = { nonce: randomUUID(), name: guild.name, status: "pending" }; state[guild.id] = request;
        await save(state);
      }
      const user = await client.users.fetch(await owner());
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PILOT_REQUEST_PREFIX}approve:${guild.id}:${request.nonce}`).setLabel("Approuver / Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PILOT_REQUEST_PREFIX}block:${guild.id}:${request.nonce}`).setLabel("Bloquer / Block").setStyle(ButtonStyle.Danger));
      const message = await user.send({ content: `**Guilded — demande d’accès / access request**\nServeur / Server: **${escapeMarkdown(guild.name).slice(0,200)}**\nID: \`${guild.id}\`\nMembres / Members: ${guild.memberCount}\nPropriétaire / Owner ID: \`${guild.ownerId}\`\n\nAucun accès avant votre approbation. Bloquer fait quitter le serveur et empêche les nouvelles demandes.\nNo access until you approve. Block leaves the server and suppresses repeat requests.`, components: [row], allowedMentions: { parse: [] } });
      request.messageId = message.id; await save(state);
    }); },
    async handle(interaction: ButtonInteraction) {
      if (!interaction.customId.startsWith(PILOT_REQUEST_PREFIX)) return false;
      if (!options.enabled || interaction.guildId || interaction.user.id !== await owner()) {
        await interaction.reply({ content: "Owner only / Réservé au propriétaire.", ephemeral: true }); return true;
      }
      await interaction.deferReply();
      await serial(async () => {
        const [, action, id, nonce] = interaction.customId.split(":");
        const state = await load(), request = id ? state[id] : undefined;
        if (!id || !["approve", "block"].includes(action ?? "") || !request || request.status !== "pending" || request.nonce !== nonce || request.messageId !== interaction.message.id) {
          await interaction.editReply("Cette demande a déjà été traitée ou a expiré. / This request was already handled or is stale."); return;
        }
        if (action === "approve") {
          const source = await readFile(envPath, "utf8");
          let next: string;
          try { next = editPilotApprovals(source, "approve", id); }
          catch (error) {
            if (error instanceof Error && error.message.includes("HOSTED_GUILD_LIMIT")) {
              await interaction.editReply("Le pilote est complet. Cette demande reste en attente. / The pilot is full. This request stays pending."); return;
            }
            throw error;
          }
          const info = await stat(envPath), temp = `${envPath}.${randomUUID()}.tmp`;
          try {
            await writeFile(temp, next, { flag: "wx", mode: info.mode & 0o777 });
            if (process.platform !== "win32") await chown(temp, info.uid, info.gid);
            if (await readFile(envPath, "utf8") !== source) throw new Error("Configuration changed; try again.");
            await rename(temp, envPath);
          } finally { await rm(temp, { force: true }); }
          options.replace(pilotFilePolicy(next).guildIds);
          request.status = "approved"; await save(state);
          const guild = client.guilds.cache.get(id);
          if (guild) {
            try { await options.activate(guild); }
            catch { await interaction.editReply("Approuvé. Configuration Discord à réessayer au redémarrage. / Approved; Discord setup will retry on restart."); return; }
          }
          await interaction.editReply(guild ? "Approuvé ! Le serveur peut utiliser /setup start. / Approved! The server can use /setup start." : `Approuvé / Approved. Réinviter / Reinvite: ${pilotInvite(next, id)}`);
        } else {
          // Never let an old pending message revoke an explicit CLI approval.
          if (pilotFilePolicy(await readFile(envPath, "utf8")).allows(id)) {
            await interaction.editReply("Déjà approuvé par le propriétaire. / Already approved by the owner."); return;
          }
          request.status = "blocked"; await save(state);
          await client.guilds.cache.get(id)?.leave();
          await interaction.editReply("Bloqué. Guilded quitte ce serveur. / Blocked. Guilded leaves this server.");
        }
        await interaction.message.edit({ components: [] }).catch(() => undefined);
      });
      return true;
    }
  };
}
