import { PermissionFlagsBits, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { benchRotation } from "./bench-rotation.js";

export const PLAN_KINDS = ["PLAYBOOK", "RECAP", "SUPPLIES"] as const;
export type PlanKind = typeof PLAN_KINDS[number];
export interface PlanPayload { summary: string; assignments: string; preparation: string; resources: { source: string; url: string; checked: string }[]; items: { name: string; perPerson: number; fixed: number }[] }
export class PlanningError extends Error {}
export function parsePlan(kind: string, fields: { summary?: string; assignments?: string; preparation?: string; resources?: string; items?: string }, now: Date): PlanPayload {
  if (!PLAN_KINDS.includes(kind as PlanKind)) throw new PlanningError("kind");
  const text = (value = "", max = 3000) => { const result = value.trim(); if (result.length > max || [...result].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw new PlanningError("text"); return result; };
  const summary = text(fields.summary), assignments = text(fields.assignments), preparation = text(fields.preparation);
  if (!summary) throw new PlanningError("summary");
  const resourceLines = text(fields.resources, 6000).split(/\r?\n/).filter(Boolean);
  if (resourceLines.length > 12) throw new PlanningError("resources");
  const resources = resourceLines.map(line => {
    const parts = line.split("|").map(p => p.trim());
    if (parts.length !== 3) throw new PlanningError("resource format");
    const [source = "", address = "", checked = ""] = parts;
    let url: URL; try { url = new URL(address); } catch { throw new PlanningError("url"); }
    if (!source || source.length > 100 || address.length > 700 || url.protocol !== "https:" || url.username || url.password || url.port
      || !url.hostname.includes(".") || /^(?:\d|\[)|(?:\.local|\.localhost)$/i.test(url.hostname)
      || [...url.searchParams.keys()].some(k => /token|secret|password|signature|api.?key|authorization/i.test(k))) throw new PlanningError("public URL required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checked) || !Number.isFinite(Date.parse(checked)) || new Date(checked).toISOString().slice(0, 10) !== checked || checked > now.toISOString().slice(0, 10)) throw new PlanningError("date");
    return { source, url: url.href, checked };
  });
  const itemLines = text(fields.items, 6000).split(/\r?\n/).filter(Boolean);
  if (itemLines.length > 30 || kind === "SUPPLIES" && !itemLines.length || kind !== "SUPPLIES" && itemLines.length) throw new PlanningError("items");
  const items = itemLines.map(line => {
    const parts = line.split("|").map(p => p.trim());
    if (parts.length !== 3) throw new PlanningError("item format");
    const [name = "", per = "", fixed = ""] = parts;
    if (!name || name.length > 100 || !/^\d{1,3}$/.test(per) || !/^\d{1,4}$/.test(fixed) || Number(per) + Number(fixed) === 0) throw new PlanningError("quantity");
    return { name, perPerson: Number(per), fixed: Number(fixed) };
  });
  if (new Set(items.map(i => i.name.toLocaleLowerCase())).size !== items.length) throw new PlanningError("duplicate item");
  return { summary, assignments, preparation, resources, items };
}

export function raidPlanningStore(db: PrismaClient, members: GuildDashboardAccess, officers: GuildDashboardAccess, client: Client | undefined) {
  async function authorize(user: string, guildId: string, raidId: string, write = false) {
    const guild = await (write ? officers : members).authorize(user, guildId);
    if (!guild || !client?.isReady()) return null;
    const raid = await db.raid.findFirst({ where: { id: raidId, guildId, isTest: false }, select: { id: true, title: true, status: true, scheduledAt: true, signupChannelId: true, guild: { select: { discordId: true } } } });
    if (!raid?.signupChannelId) return null;
    const discord = await client.guilds.fetch(raid.guild.discordId);
    const member = await discord.members.fetch({ user, force: true });
    const channel = await discord.channels.fetch(raid.signupChannelId, { force: true });
    if (!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return null;
    return { guild, raid };
  }
  const latest = (raidId: string, kind: PlanKind) => db.raidPlanRevision.findFirst({ where: { raidId, kind }, orderBy: { revision: "desc" } });
  return {
    guilds: members.guilds,
    async list(user: string, guildId: string) {
      if (!await members.authorize(user, guildId) || !client?.isReady()) return null;
      const source = await db.guild.findUniqueOrThrow({ where: { id: guildId }, select: { discordId: true } });
      const discord = await client.guilds.fetch(source.discordId);
      const member = await discord.members.fetch({ user, force: true });
      const channels = await discord.channels.fetch();
      const visible = channels.filter(c => !!c?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).map(c => c!.id);
      return db.raid.findMany({ where: { guildId, isTest: false, signupChannelId: { in: visible } }, orderBy: { scheduledAt: "desc" }, select: { id: true, title: true, scheduledAt: true }, take: 60 });
    },
    async load(user: string, guildId: string, raidId: string, kind: PlanKind) {
      const scope = await authorize(user, guildId, raidId); if (!scope) return null;
      const officer = !!await officers.authorize(user, guildId);
      const current = await latest(raidId, kind);
      const confirmed = await db.raidSignup.count({ where: { raidId, status: "SIGNED_UP", member: { guildId, isTest: false, status: "ACTIVE" } } });
      const own = await db.member.findFirst({ where: { guildId, discordUserId: user, isTest: false, status: "ACTIVE" }, select: { id: true } });
      const totals = current?.active && kind === "SUPPLIES" ? await db.raidSupplyPledge.groupBy({ by: ["itemIndex"], where: { revisionId: current.id, member: { guildId, status: "ACTIVE", isTest: false } }, _sum: { quantity: true, delivered: true } }) : [];
      const pledges = current && own ? await db.raidSupplyPledge.findMany({ where: { revisionId: current.id, memberId: own.id }, select: { itemIndex: true, quantity: true, delivered: true } }) : [];
      const history = officer ? await db.raidPlanRevision.findMany({ where: { raidId, kind }, orderBy: { revision: "desc" }, take: 20 }) : [];
      let rotation = null;
      if (officer) {
        const target = await db.raid.findFirst({ where: { id: raidId, guildId }, select: { coreId: true, tankLimit: true, healerLimit: true, dpsLimit: true,
          signups: { where: { member: { guildId, status: "ACTIVE", isTest: false }, status: { in: ["SIGNED_UP", "WAITLISTED"] } }, take: 201,
            select: { memberId: true, role: true, status: true, signedUpAt: true, member: { select: { displayName: true } } } } } });
        if (target?.coreId) {
          const previous = await db.raid.findMany({ where: { guildId, coreId: target.coreId, isTest: false, status: "COMPLETED", scheduledAt: { lt: scope.raid.scheduledAt } },
            orderBy: { scheduledAt: "desc" }, take: 8, select: { attendance: { where: { memberId: { in: target.signups.map(s => s.memberId) } }, select: { memberId: true, status: true } } } });
          rotation = { historyCount: previous.length, limited: target.signups.length > 200, roles: benchRotation(target.signups.slice(0, 200).map(s => ({ ...s, name: s.member.displayName })), previous,
            { TANK: target.tankLimit, HEALER: target.healerLimit, DPS: target.dpsLimit }) };
        }
      }
      return { ...scope, officer, current: current && (current.active || officer) ? current : null, confirmed, totals, pledges, history, rotation };
    },
    async publish(user: string, guildId: string, raidId: string, kind: PlanKind, expected: number, payload: PlanPayload, active: boolean) {
      if (!await authorize(user, guildId, raidId, true)) throw new PlanningError("access");
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Raid" WHERE "id" = ${raidId} AND "guildId" = ${guildId} FOR UPDATE`;
        const previous = await tx.raidPlanRevision.findFirst({ where: { raidId, kind }, orderBy: { revision: "desc" } });
        if ((previous?.revision ?? 0) !== expected) throw new PlanningError("stale");
        const row = await tx.raidPlanRevision.create({ data: { raidId, kind, revision: expected + 1, active, payload: JSON.parse(JSON.stringify(payload)), approvedBy: user } });
        await tx.auditLog.create({ data: { guildId, actorId: user, action: "CONFIG_UPDATED", entityId: row.id, metadata: { kind: "raid-plan", plan: kind, revision: row.revision, active } } });
        return row;
      });
    },
    async pledge(user: string, guildId: string, raidId: string, revisionId: string, itemIndex: number, quantity: number, delivered: number) {
      const scope = await authorize(user, guildId, raidId);
      if (!scope || !["PLANNED", "ACTIVE"].includes(scope.raid.status)) throw new PlanningError("access");
      if (![itemIndex, quantity, delivered].every(Number.isSafeInteger) || itemIndex < 0 || quantity < 0 || quantity > 9999 || delivered < 0 || delivered > quantity) throw new PlanningError("quantity");
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Raid" WHERE "id" = ${raidId} AND "guildId" = ${guildId} FOR UPDATE`;
        const raid = await tx.raid.findFirst({ where: { id: raidId, guildId, status: { in: ["PLANNED", "ACTIVE"] }, isTest: false } });
        if (!raid) throw new PlanningError("closed");
        const current = await tx.raidPlanRevision.findFirst({ where: { raidId, kind: "SUPPLIES" }, orderBy: { revision: "desc" } });
        const member = await tx.member.findFirst({ where: { guildId, discordUserId: user, status: "ACTIVE", isTest: false }, select: { id: true } });
        const payload = current?.payload as unknown as PlanPayload;
        if (!current?.active || current.id !== revisionId || !payload.items[itemIndex] || !member) throw new PlanningError("stale");
        const where = { revisionId: current.id, memberId: member.id, itemIndex };
        await tx.raidSupplyPledge.upsert({ where: { revisionId_memberId_itemIndex: where }, create: { ...where, quantity, delivered }, update: { quantity, delivered } });
      });
    }
  };
}
