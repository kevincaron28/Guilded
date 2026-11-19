import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { postToLogChannel } from "./housekeeping.js";

// The officers' shared "do not invite" list. Officer-only: entries are never shown to members, never
// public. A match only warns officers (the officer log; the officers' addon for names, without the
// reason); nothing is blocked, kicked or hidden automatically. Entries expire (one year by default).
export type DniKind = "KICKED" | "LEFT_BADLY" | "SCAMMER" | "OTHER";
export type DniStatus = "ACTIVE" | "APPEALED" | "CLEARED";
export interface DniEntry {
  id: string; name: string; realm: string | null; discordUserId: string | null; reason: string; addedBy: string; createdAt: Date;
  kind?: DniKind; expiresAt?: Date | null; evidence?: string | null; status?: DniStatus; aliasGroup?: string | null;
}
export interface DniCandidate { discordUserId?: string | null; names?: string[] }
export type DniExpiry = "1m" | "6m" | "1y" | "forever";
export const DNI_KINDS: readonly DniKind[] = ["KICKED", "LEFT_BADLY", "SCAMMER", "OTHER"];
const DAY_MS = 86_400_000;

export const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const realmKey = (value: string) => fold(value).replace(/[\s'-]/g, "");

// "Name", "Name-Realm" or "First Last-Realm": the realm is after the last hyphen.
export function splitCharacter(value: string): { name: string; realm: string | null } {
  const at = value.lastIndexOf("-");
  return at > 0 ? { name: fold(value.slice(0, at)), realm: realmKey(value.slice(at + 1)) || null } : { name: fold(value), realm: null };
}

/** Expired and cleared entries never match; an appealed one still does until officers decide. */
export function dniActive(entry: Pick<DniEntry, "status" | "expiresAt">, now = new Date()): boolean {
  return entry.status !== "CLEARED" && (!entry.expiresAt || entry.expiresAt.getTime() > now.getTime());
}

export function dniExpiryDate(choice: DniExpiry | null | undefined, now = new Date()): Date | null {
  if (choice === "forever") return null;
  const days = choice === "1m" ? 30 : choice === "6m" ? 182 : 365;
  return new Date(now.getTime() + days * DAY_MS);
}

/** certain false: only a name matched (no realm and no Discord account on either side), so it may be someone else. */
export interface DniMatch { entry: DniEntry; certain: boolean }

export function dniMatchesDetailed(entries: DniEntry[], candidate: DniCandidate, now = new Date()): DniMatch[] {
  const names = (candidate.names ?? []).filter(Boolean).map(splitCharacter);
  const out: DniMatch[] = [];
  for (const entry of entries) {
    if (!dniActive(entry, now)) continue;
    if (entry.discordUserId && candidate.discordUserId && entry.discordUserId === candidate.discordUserId) { out.push({ entry, certain: true }); continue; }
    const name = fold(entry.name), realm = entry.realm ? realmKey(entry.realm) : null;
    const hit = names.filter((candidateName) => candidateName.name === name && (!realm || !candidateName.realm || realm === candidateName.realm));
    if (hit.length) out.push({ entry, certain: !!realm && hit.some((candidateName) => candidateName.realm === realm) });
  }
  // A person's alts are one person: when one entry matches, the others of its alias group follow it.
  const groups = new Set(out.map((match) => match.entry.aliasGroup).filter(Boolean));
  for (const entry of entries) {
    if (entry.aliasGroup && groups.has(entry.aliasGroup) && dniActive(entry, now) && !out.some((match) => match.entry.id === entry.id)) out.push({ entry, certain: true });
  }
  return out;
}

export function dniMatches(entries: DniEntry[], candidate: DniCandidate, now = new Date()): DniEntry[] {
  return dniMatchesDetailed(entries, candidate, now).map((match) => match.entry);
}

/** Names only (no reason, no Discord id) for the officers' addon, active entries only. */
export function dniNamesForAddon(entries: DniEntry[], now = new Date()): string[] {
  const names = new Set<string>();
  for (const entry of entries) if (dniActive(entry, now)) names.add(`${entry.name}${entry.realm ? `-${entry.realm}` : ""}`);
  return [...names].slice(0, 300);
}

export function dniWarning(entry: DniEntry, who: string, where: "application" | "join" | "invite", certain = true): string {
  const day = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:D>`;
  const verb = where === "application" ? "applied" : where === "invite" ? "asked to be invited" : "joined the Discord";
  const lead = certain ? `${who} ${verb} and matches` : `${who} ${verb} and **possibly** matches (same name only; it may be someone else)`;
  return `⚠️ Do-not-invite list: ${lead} **${entry.name}${entry.realm ? `-${entry.realm}` : ""}**`
    + ` — ${entry.reason} (added by <@${entry.addedBy}>, ${day}). Nothing was blocked; review with /mod dni list.`;
}

type Db = Pick<PrismaClient, "doNotInvite"> & Partial<Pick<PrismaClient, "character" | "member" | "auditLog">>;

export interface DniAddInput {
  name: string; realm?: string | null; discordUserId?: string | null; reason: string; addedBy: string;
  kind?: DniKind; expiry?: DniExpiry; evidence?: string | null; now?: Date;
}

export function createDoNotInviteService(database: Db) {
  const audit = (guildId: string, actorId: string, action: "DNI_ADDED" | "DNI_CLEARED" | "DNI_APPEAL" | "DNI_ALIAS", entityId: string, metadata: Record<string, unknown>) =>
    database.auditLog ? database.auditLog.create({ data: { guildId, actorId, action, entityId, metadata: metadata as never } }).catch(() => undefined) : Promise.resolve(undefined);

  // The same person's other characters: the member behind the Discord id, or behind a character of this name.
  async function knownAlts(guildId: string, name: string, discordUserId: string | null): Promise<{ names: string[]; discordUserId: string | null }> {
    if (!database.member || !database.character) return { names: [], discordUserId };
    let memberId: string | null = null, discord = discordUserId;
    if (discordUserId) memberId = (await database.member.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } }, select: { id: true } }))?.id ?? null;
    if (!memberId) {
      const wanted = fold(name);
      const rows = await database.character.findMany({ where: { guildId, name: { equals: name.trim(), mode: "insensitive" } }, select: { memberId: true, name: true }, take: 5 });
      const hit = rows.find((row) => fold(row.name) === wanted);
      memberId = hit?.memberId ?? null;
      if (memberId && !discord) {
        const found = await database.member.findUnique({ where: { id: memberId }, select: { discordUserId: true } });
        if (found && /^\d{5,25}$/.test(found.discordUserId)) discord = found.discordUserId;
      }
    }
    if (!memberId) return { names: [], discordUserId: discord };
    const characters = await database.character.findMany({ where: { memberId }, select: { name: true }, take: 12 });
    return { names: characters.map((row) => row.name).filter((other) => fold(other) !== fold(name)), discordUserId: discord };
  }

  return {
    async add(guildId: string, input: DniAddInput) {
      let name = input.name.trim(), realm = input.realm?.trim() || null;
      const reason = input.reason.trim();
      // "First Last-Realm": the realm after the last hyphen of a name with a space (a hyphenated surname is not a realm).
      const typed = !realm ? /^(.+ .+)-([^-\s][^-]*)$/.exec(name) : null;
      if (typed) { name = typed[1]!.trim(); realm = typed[2]!.trim(); }
      if (name.length < 2 || name.length > 60) throw new Error("Give a character name of 2 to 60 characters.");
      if (reason.length < 3) throw new Error("Give a short reason (officers see it when there is a match).");
      const now = input.now ?? new Date();
      const expiresAt = dniExpiryDate(input.expiry, now);
      const alts = await knownAlts(guildId, name, input.discordUserId ?? null).catch(() => ({ names: [] as string[], discordUserId: input.discordUserId ?? null }));
      const base = { guildId, reason: reason.slice(0, 200), addedBy: input.addedBy, kind: input.kind ?? "KICKED", expiresAt, evidence: input.evidence?.trim().slice(0, 500) || null };
      const aliasGroup = alts.names.length ? `a${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;
      const entry = await database.doNotInvite.create({ data: { ...base, name, realm, discordUserId: alts.discordUserId, aliasGroup } });
      // Known alts become their own entries (so each name can expire on its own), in the same alias group.
      let existing: DniEntry[] = [];
      if (alts.names.length) existing = await database.doNotInvite.findMany({ where: { guildId, status: { not: "CLEARED" } }, take: 500 });
      for (const alt of alts.names.slice(0, 10)) {
        if (dniMatchesDetailed(existing, { names: [alt] }, now).length) continue;
        await database.doNotInvite.create({ data: { ...base, name: alt, realm: null, discordUserId: alts.discordUserId, aliasGroup } });
      }
      await audit(guildId, input.addedBy, "DNI_ADDED", entry.id, { kind: base.kind, forever: !expiresAt, alts: alts.names.length });
      return entry;
    },
    /** Marks an entry (and its alias group) cleared; kept for the audit trail until the purge. */
    async clear(guildId: string, id: string, actorId: string) {
      const row = await database.doNotInvite.findFirst({ where: { id, guildId, status: { not: "CLEARED" } } });
      if (!row) throw new Error("That entry was not found.");
      const group = row.aliasGroup ? { aliasGroup: row.aliasGroup } : { id };
      const cleared = await database.doNotInvite.updateMany({ where: { guildId, status: { not: "CLEARED" }, ...group }, data: { status: "CLEARED", clearedBy: actorId, clearedAt: new Date() } });
      await audit(guildId, actorId, "DNI_CLEARED", id, { entries: cleared.count });
      return row;
    },
    /** Kept for callers that still say "remove". */
    async remove(guildId: string, id: string, actorId = "system") { await this.clear(guildId, id, actorId); },
    /** Links two names as one person: they share an alias group, and a name with no entry yet gets one like the first. */
    async alias(guildId: string, firstId: string, otherName: string, actorId: string) {
      const first = await database.doNotInvite.findFirst({ where: { id: firstId, guildId, status: { not: "CLEARED" } } });
      if (!first) throw new Error("That entry was not found.");
      const wanted = splitCharacter(otherName);
      if (!wanted.name || wanted.name === fold(first.name)) throw new Error("Give a different character name.");
      const rows: DniEntry[] = await database.doNotInvite.findMany({ where: { guildId, status: { not: "CLEARED" } }, take: 500 });
      const other = rows.find((row) => fold(row.name) === wanted.name && (!row.realm || !wanted.realm || realmKey(row.realm) === wanted.realm));
      const group = first.aliasGroup ?? other?.aliasGroup ?? `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await database.doNotInvite.updateMany({ where: { id: first.id }, data: { aliasGroup: group } });
      if (other) await database.doNotInvite.updateMany({ where: { guildId, OR: [{ id: other.id }, ...(other.aliasGroup ? [{ aliasGroup: other.aliasGroup }] : [])] }, data: { aliasGroup: group } });
      else await database.doNotInvite.create({ data: { guildId, name: otherName.trim().slice(0, 60), realm: null, discordUserId: first.discordUserId, reason: first.reason, addedBy: actorId, kind: first.kind, expiresAt: first.expiresAt, evidence: first.evidence, aliasGroup: group } });
      await audit(guildId, actorId, "DNI_ALIAS", first.id, { created: !other });
      return group;
    },
    /** Active (not cleared, not expired) entries, newest first. */
    list(guildId: string, options: { skip?: number; take?: number; now?: Date } = {}) {
      const now = options.now ?? new Date();
      return database.doNotInvite.findMany({ where: { guildId, status: { not: "CLEARED" }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: "desc" }, skip: options.skip ?? 0, take: options.take ?? 100 });
    },
    count(guildId: string, now = new Date()) {
      return database.doNotInvite.count({ where: { guildId, status: { not: "CLEARED" }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    },
    /** The active entries tied to this Discord account in this Discord server (for the person's own appeal). */
    forUser(discordId: string, discordUserId: string, now = new Date()) {
      return database.doNotInvite.findMany({ where: { discordUserId, status: { not: "CLEARED" }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], guild: { discordId } }, take: 20 });
    },
    async setAppealed(guildId: string, id: string, actorId: string) {
      const changed = await database.doNotInvite.updateMany({ where: { id, guildId, status: "ACTIVE" }, data: { status: "APPEALED" } });
      if (changed.count) await audit(guildId, actorId, "DNI_APPEAL", id, { decision: "opened" });
      return changed.count > 0;
    },
    /** An officer's decision on an appeal: uphold keeps the entry active, clear clears it (and its alts). */
    async decideAppeal(guildId: string, id: string, actorId: string, decision: "uphold" | "clear") {
      if (decision === "clear") { await this.clear(guildId, id, actorId); return; }
      await database.doNotInvite.updateMany({ where: { id, guildId, status: "APPEALED" }, data: { status: "ACTIVE" } });
      await audit(guildId, actorId, "DNI_APPEAL", id, { decision: "upheld" });
    },
    // Every in-game guild sharing this Discord server: someone joining the server concerns them all.
    forDiscordServer(discordId: string) {
      return database.doNotInvite.findMany({ where: { guild: { discordId }, status: { not: "CLEARED" } }, take: 500 });
    }
  };
}

/** The names the officers' addon flags for one in-game guild (names only, no reason, no Discord id). */
export async function dniNamesForGuild(database: Pick<PrismaClient, "doNotInvite">, guildId: string, now = new Date()): Promise<string[]> {
  const rows = await database.doNotInvite.findMany({ where: { guildId, status: { not: "CLEARED" }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, take: 500 });
  return dniNamesForAddon(rows, now);
}

// Never throws: a warning must not be able to break the application or join that triggered it.
export async function warnDoNotInvite(discordGuild: DiscordGuild | null, candidate: DniCandidate, who: string, where: "application" | "join" | "invite", database: Pick<PrismaClient, "doNotInvite"> = prisma): Promise<void> {
  if (!discordGuild || !(database as Partial<typeof database>).doNotInvite) return;
  try {
    const matches = dniMatchesDetailed(await createDoNotInviteService(database).forDiscordServer(discordGuild.id), candidate);
    for (const match of matches.slice(0, 3)) await postToLogChannel(discordGuild, dniWarning(match.entry, who, where, match.certain));
  } catch (error) {
    console.error("Do-not-invite check failed", error);
  }
}
