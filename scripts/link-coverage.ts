// Read-only link-coverage report: per Discord guild, how many members are linked to WoW characters.
// SELECT only, no Discord calls. Console shows counts only; names and Discord IDs go to
// link-coverage.md (gitignored: never commit or paste it publicly).
// Run: npm run link:coverage
import { writeFileSync } from "node:fs";
import { createPrismaClient } from "../src/database.js";
import { summarizeCoverage, type CoverageMember } from "../src/services/link-coverage.js";
import { nameKey } from "../src/services/roster-discovery.js";

const database = createPrismaClient();
try {
  const guilds = await database.guild.findMany({ select: { id: true, discordId: true, name: true, scopeKey: true, gameEdition: true }, orderBy: { name: "asc" } });
  const webAccounts = await database.webCompanionCredential.findMany({ where: { revokedAt: null }, select: { account: { select: { discordUserId: true } } } });
  const webDevices = new Map<string, number>();
  for (const row of webAccounts) webDevices.set(row.account.discordUserId, (webDevices.get(row.account.discordUserId) ?? 0) + 1);

  const report: string[] = ["# Link coverage", "", `Generated ${new Date().toISOString()}. Contains Discord IDs: never commit or share publicly.`, ""];
  const table: Record<string, string | number>[] = [];
  for (const guild of guilds) {
    const [members, unclaimed, claims] = await Promise.all([
      database.member.findMany({
        where: { guildId: guild.id, status: { not: "LEFT" }, isTest: false },
        select: { id: true, discordUserId: true, displayName: true, characters: { select: { name: true, realm: true } }, companionCredentials: { where: { revokedAt: null }, select: { id: true } } }
      }),
      database.unclaimedCharacter.findMany({ where: { guildId: guild.id }, select: { name: true, realm: true } }),
      database.characterVerifyClaim.findMany({ where: { guildId: guild.id, status: "PROVISIONAL" }, select: { memberId: true, nameKey: true } })
    ]);
    const provisional = new Map<string, string[]>();
    for (const claim of claims) provisional.set(claim.memberId, [...(provisional.get(claim.memberId) ?? []), claim.nameKey]);
    const input: CoverageMember[] = members.map((m) => ({
      memberId: m.id, discordUserId: m.discordUserId, displayName: m.displayName,
      characters: m.characters.map((c) => ({ name: c.name, realm: c.realm, nameKey: nameKey(c.name) })),
      companionDevices: m.companionCredentials.length + (webDevices.get(m.discordUserId) ?? 0),
      provisionalKeys: provisional.get(m.id) ?? []
    }));
    const { summary, rows } = summarizeCoverage(input, unclaimed);
    const label = `${guild.name} [${guild.gameEdition}/${guild.scopeKey}]`;
    table.push({ guild: label, members: summary.members, linked: summary.linked, verified: summary.fullyVerified, provisional: summary.hasProvisional, unlinked: summary.unlinked, companion: summary.withCompanion, "unclaimed chars": summary.unclaimedCharacters });
    report.push(`## ${label} (Discord ${guild.discordId})`, "",
      `- Members known: ${summary.members}`, `- Linked (>=1 character): ${summary.linked} (all verified: ${summary.fullyVerified}, with a provisional character: ${summary.hasProvisional})`,
      `- Not linked: ${summary.unlinked}`, `- With a companion pairing: ${summary.withCompanion} (linked but no companion: ${summary.linkedWithoutCompanion}; companion but no character: ${summary.companionWithoutLink})`,
      `- Characters linked: ${summary.characters} (provisional: ${summary.provisionalCharacters})`, `- Characters seen in uploads, not linked to anyone: ${summary.unclaimedCharacters}`, "",
      "### Members (unlinked first)", "", "| Discord ID | Name | State | Companion | Characters |", "|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.discordUserId} | ${r.displayName.replace(/\|/g, "/")} | ${r.state} | ${r.companion ? "yes" : "no"} | ${r.characters.join(", ") || "-"} |`), "",
      "### Unlinked characters seen in uploads", "", ...(unclaimed.length ? unclaimed.map((u) => `- ${u.name} (${u.realm})`) : ["(none)"]), "");
  }
  writeFileSync("link-coverage.md", report.join("\n"));
  console.table(table);
  console.log("Detailed list written to link-coverage.md (gitignored; holds Discord IDs).");
} finally {
  await database.$disconnect();
}
