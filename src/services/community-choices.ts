import type { Guild } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import type { Lang } from "../i18n.js";
import { accessibleCommunityActivities, accessibleCommunitySeasons } from "./community-access.js";
import { communitySeasonLabel } from "./community-display.js";

export async function communityChoices(database: PrismaClient, guild: Guild, guildId: string, actor: string, command: string, sub: string | null, option: string, query: string, lang: Lang) {
  const needle = query.trim().toLocaleLowerCase();
  if (option === "season") {
    const all = await accessibleCommunitySeasons(database, guild, guildId, actor);
    const history = ["leaderboard", "wallet", "hub", "status", "history", "list", "season-settings", "claims", "review", "settings"].includes(sub ?? "");
    return all.filter(s => (history || s.status === "ACTIVE") && (command !== "participation" && !["dice", "quiz"].includes(sub ?? "") || s.game === "DISCORD"))
      .map(s => ({ name: `${s.game} · ${communitySeasonLabel(s, lang)} · ${s.status === "ACTIVE" ? lang === "fr" ? "En cours" : "Active" : lang === "fr" ? "Archivée" : "Archived"}`.slice(0, 100), value: s.id }))
      .filter(c => `${c.name} ${c.value}`.toLocaleLowerCase().includes(needle)).slice(0, 25);
  }
  const kind = { lottery: "LOTTERY", gaming: "EVENT", challenge: "CHALLENGE", community: "QUIZ" }[command];
  const rows = await accessibleCommunityActivities(database, guild, guildId, actor);
  return rows.filter(r => !kind || r.kind === kind).filter(r => !["join", "submit", "edit"].includes(sub ?? "") || r.status === "OPEN" && r.season.status === "ACTIVE" && r.endsAt > new Date())
    .map(r => ({ name: `${r.title.slice(0, 48)} · ${communitySeasonLabel(r.season, lang).slice(0, 30)} · ${r.endsAt.toISOString().slice(0, 10)}`.slice(0, 100), value: r.id }))
    .filter(c => `${c.name} ${c.value}`.toLocaleLowerCase().includes(needle)).slice(0, 25);
}
