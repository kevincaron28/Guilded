import { mkdir, readFile, rename, rm, stat, writeFile, chown } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type ButtonInteraction, type Client, type Guild, MessageFlags } from "discord.js";
import { editPilotApprovals, pilotFilePolicy, pilotInvite } from "./pilot-admin.js";

export const PILOT_REQUEST_PREFIX = "pilot-request:";
// pending: waiting with no access; lite: waiting with the Lite command set (both await a decision).
// activeAt/warnedAt (ms): last command use on a Lite server, and when it was told it is idle.
type Request = { nonce: string; name: string; status: "pending" | "lite" | "blocked" | "approved"; messageId?: string; activeAt?: number; warnedAt?: number };
const DAY = 24 * 60 * 60 * 1000;
export const LITE_IDLE_WARN_MS = 30 * DAY, LITE_IDLE_LEAVE_MS = 7 * DAY;
// Command use is saved at most this often per server, so busy Lite servers don't rewrite the file.
const TOUCH_SAVE_MS = 6 * 60 * 60 * 1000;
type State = Record<string, Request>;
type Options = { enabled: boolean; allows: (id: string) => boolean; replace: (ids: string[]) => void;
  // How many waiting servers get Guilded Lite (default 0: none), and where the running bot keeps that list.
  liteLimit?: number; replaceLite?: (ids: string[]) => void;
  activate: (guild: Guild) => Promise<void>;
  // Tells the approved server's owner (true when the message was delivered). Must not throw.
  welcome?: (guild: Guild) => Promise<boolean>;
  // Tells an idle Lite server it will be left (true when delivered). Must not throw.
  warnIdle?: (guild: Guild) => Promise<boolean>;
  envPath?: string; statePath?: string; now?: () => number };

// Local state avoids waking Postgres for admission checks and survives normal deploys.
// Only this single bot process handles decisions; the CLI remains an emergency override.
export function createPilotRequests(client: Client, options: Options) {
  const envPath = options.envPath ?? ".env.local", statePath = options.statePath ?? "backups/pilot-requests.json";
  const now = options.now ?? Date.now;
  const touched = new Map<string, number>();
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
  const open = (request?: Request) => request?.status === "pending" || request?.status === "lite";
  const syncLite = (state: State) => options.replaceLite?.(Object.entries(state).filter(([, row]) => row.status === "lite").map(([id]) => id));
  const save = async (state: State) => {
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    const temp = `${statePath}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await rename(temp, statePath); }
    finally { await rm(temp, { force: true }); }
    syncLite(state);
  };
  return {
    /** Loads the Lite list at startup, before commands are registered. */
    restore() { return serial(async () => { if (options.enabled) syncLite(await load()); }); },
    /** The bot left (or was removed from) a waiting server: free its slot; a rejoin asks again. */
    forget(guildId: string) { return serial(async () => {
      if (!options.enabled) return;
      const state = await load();
      if (!open(state[guildId])) return;
      delete state[guildId]; await save(state);
    }); },
    /** A command was used on a Lite server: it is not idle. Cheap to call on every interaction. */
    touch(guildId: string) {
      const at = now();
      if (!options.enabled || at - (touched.get(guildId) ?? 0) < TOUCH_SAVE_MS) return Promise.resolve();
      touched.set(guildId, at);
      return serial(async () => {
        const state = await load(), request = state[guildId];
        if (request?.status !== "lite") return;
        request.activeAt = at; delete request.warnedAt; await save(state);
      });
    },
    /** Hourly: warn Lite servers idle for 30 days, and leave those still idle 7 days after the warning. */
    sweepIdle() { return serial(async () => {
      if (!options.enabled) return;
      const state = await load(), at = now();
      let changed = false;
      for (const [id, request] of Object.entries(state)) {
        if (request.status !== "lite" || options.allows(id)) continue;
        const guild = client.guilds.cache.get(id);
        if (!guild) continue;
        // Entries from before idle tracking start their 30 days now.
        if (request.activeAt === undefined) { request.activeAt = at; changed = true; continue; }
        if (request.warnedAt !== undefined && at - request.warnedAt >= LITE_IDLE_LEAVE_MS) {
          // Dropped (not blocked) first, so GuildDelete has nothing to do and a later invite asks again.
          delete state[id]; await save(state); changed = false;
          await guild.leave();
        } else if (request.warnedAt === undefined && at - request.activeAt >= LITE_IDLE_WARN_MS) {
          await options.warnIdle?.(guild).catch(() => false);
          request.warnedAt = at; changed = true;
        }
      }
      if (changed) await save(state);
    }); },
    request(guild: Guild) { return serial(async () => {
      if (!options.enabled || options.allows(guild.id)) return;
      const state = await load();
      if (state[guild.id]?.status === "blocked") { await guild.leave(); return; }
      let request = state[guild.id];
      if (open(request) && request?.messageId) return;
      if (!request || !open(request)) {
        const waiting = Object.values(state).filter(open);
        if (waiting.length >= 100) { await guild.leave(); return; }
        // Lite is granted (and saved) before the owner DM, so a closed DM never holds it back.
        // A server approved from the CLI while on Lite no longer takes a Lite slot.
        const lite = Object.entries(state).filter(([id, row]) => row.status === "lite" && !options.allows(id)).length < (options.liteLimit ?? 0);
        request = { nonce: randomUUID(), name: guild.name, status: lite ? "lite" : "pending", ...(lite ? { activeAt: now() } : {}) }; state[guild.id] = request;
        await save(state);
      }
      const full = (options.liteLimit ?? 0) > 0;
      const user = await client.users.fetch(await owner());
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PILOT_REQUEST_PREFIX}approve:${guild.id}:${request.nonce}`).setLabel("Approuver / Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PILOT_REQUEST_PREFIX}block:${guild.id}:${request.nonce}`).setLabel("Bloquer / Block").setStyle(ButtonStyle.Danger));
      const message = await user.send({ content: `**Guilded — demande d’accès / access request**\nServeur / Server: **${escapeMarkdown(guild.name).slice(0,200)}**\nID: \`${guild.id}\`\nMembres / Members: ${guild.memberCount}\nPropriétaire / Owner ID: \`${guild.ownerId}\`\n\n${request.status === "lite"
        ? "Accès Lite accordé automatiquement (configuration, aide, FAQ, rapports de bugs, groupes de donjon, inscriptions simples). Approuver débloque tout. Bloquer fait quitter le serveur et empêche les nouvelles demandes.\nLite access granted automatically (setup, help, FAQ, bug reports, dungeon groups, basic signups). Approve unlocks everything. Block leaves the server and suppresses repeat requests."
        : `Aucun accès avant votre approbation${full ? " (places Lite complètes)" : ""}. Bloquer fait quitter le serveur et empêche les nouvelles demandes.\nNo access until you approve${full ? " (Lite slots full)" : ""}. Block leaves the server and suppresses repeat requests.`}`, components: [row], allowedMentions: { parse: [] } });
      request.messageId = message.id; await save(state);
    }); },
    async handle(interaction: ButtonInteraction) {
      if (!interaction.customId.startsWith(PILOT_REQUEST_PREFIX)) return false;
      if (!options.enabled || interaction.guildId || interaction.user.id !== await owner()) {
        await interaction.reply({ content: "Owner only / Réservé au propriétaire.", flags: MessageFlags.Ephemeral }); return true;
      }
      await interaction.deferReply();
      await serial(async () => {
        const [, action, id, nonce] = interaction.customId.split(":");
        const state = await load(), request = id ? state[id] : undefined;
        if (!id || !["approve", "block"].includes(action ?? "") || !request || !open(request) || request.nonce !== nonce || request.messageId !== interaction.message.id) {
          await interaction.editReply("Cette demande a déjà été traitée ou a expiré. / This request was already handled or is stale."); return;
        }
        if (action === "approve") {
          const source = await readFile(envPath, "utf8");
          let next: string;
          try { next = editPilotApprovals(source, "approve", id); }
          catch (error) {
            if (error instanceof Error && error.message.includes("HOSTED_GUILD_LIMIT")) {
              await interaction.editReply(request.status === "lite"
                ? "Le pilote est complet. Ce serveur reste en Lite. / The pilot is full. This server stays on Lite."
                : "Le pilote est complet. Cette demande reste en attente. / The pilot is full. This request stays pending."); return;
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
          if (!guild) {
            await interaction.editReply(`Approuvé / Approved. Réinviter / Reinvite: ${pilotInvite(next, id)}`);
          } else {
            const welcomed = options.welcome ? await options.welcome(guild).catch(() => false) : false;
            const note = !options.welcome ? ""
              : welcomed ? "\nLe propriétaire du serveur a reçu un message de bienvenue. / The server owner was sent a welcome message."
              : "\nMessage privé au propriétaire impossible (MP fermés ?). / Could not DM the server owner (DMs closed?).";
            await interaction.editReply(`Approuvé ! Le serveur peut utiliser /setup start. / Approved! The server can use /setup start.${note}`);
          }
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
