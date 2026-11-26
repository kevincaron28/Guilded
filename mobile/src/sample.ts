import type { Feed } from "./feed";
// Fictional guild used by "Look at a sample guild". It is not a Discord account and it
// never leaves the phone. The same parsers that read the live API read this payload.

export const sampleHubBody = {
  me: { officer: false, raidLeader: false },
  updatedAt: "2026-11-03T18:00:00.000Z",
  guild: { name: "Northwind", edition: "forever" },
  link: { battleNet: true, characters: true, battleTag: "Northwind#1234" },
  characters: [
    {
      id: "char-aelira", name: "Aelira", displayName: null, realm: "Stonehall", className: "Shaman", spec: "Restoration", level: 60,
      isMain: true, edition: "forever", rank: "Raider",
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: [{ id: "core-thu", name: "Thursday", role: "HEALER", bench: false, trial: false, backup: false, lootMode: "RESERVE" }]
    },
    {
      id: "char-borin", name: "Borin", displayName: null, realm: "Stonehall", className: "Warrior", spec: "Protection", level: 60,
      isMain: false, edition: "forever", rank: "Raider",
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: [{ id: "core-thu", name: "Thursday", role: "TANK", bench: true, trial: false, backup: false, lootMode: "RESERVE" }]
    },
    {
      id: "char-cindra", name: "Cindra", displayName: null, realm: "Stonehall", className: "Mage", spec: "Frost", level: 58,
      isMain: false, edition: "forever", rank: null,
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: []
    }
  ],
  reserves: {
    remote: null,
    writable: false,
    list: { active: true, open: true, title: "Barrow Deeps", perPlayer: 2, keeper: "officer", syncedAt: "2026-11-03T17:40:00.000Z" },
    items: [
      { itemId: 1, itemName: "Barrowsteel Greatsword", characters: ["Aelira"], mine: true },
      { itemId: 2, itemName: "Stormbound Longblade", characters: ["Mira"], mine: false }
    ],
    mineCount: 1,
    cores: [
      { id: "core-thu", name: "Thursday", lootMode: "RESERVE", reservesPerPlayer: 2 },
      { id: "core-sun", name: "Sunday", lootMode: "EPGP", reservesPerPlayer: 1 }
    ]
  }
};

/** The sample guild's activity feed (made-up names, the last few days). */
export function sampleFeed(now = Date.now()): Feed {
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  return { days: 14, items: [
    { kind: "raidKill", at: at(2), actor: "Barrow Warden", boss: "Barrow Warden", instance: "Barrow Deeps" },
    { kind: "donation", at: at(5), actor: "Borin", copper: 250000 },
    { kind: "promote", at: at(26), actor: "Mira", target: "Cindra", rank: "Raider" },
    { kind: "join", at: at(30), actor: "Cindra" },
    { kind: "donation", at: at(50), actor: "Aelira", item: "Runecloth", count: 20 },
    { kind: "leave", at: at(72), actor: "Tobin" }
  ] };
}

export const sampleManageBody = {
  me: { officer: false, raidLeader: false },
  updatedAt: "2026-11-03T18:00:00.000Z",
  edition: "forever",
  guildName: "Northwind",
  characters: [
    {
      id: "char-aelira", name: "Aelira", displayName: null, realm: "Stonehall", className: "Shaman", isMain: true,
      wishlist: [{ itemName: "Emberforged Warhammer", priority: 1 }, { itemName: "Gravewarden Mace", priority: 2 }]
    },
    {
      id: "char-borin", name: "Borin", displayName: null, realm: "Stonehall", className: "Warrior", isMain: false,
      wishlist: []
    }
  ],
  cores: [
    {
      id: "core-thu", name: "Thursday",
      effective: { lootMode: "RESERVE" },
      leaderboard: [
        { rank: 1, name: "Aelira", character: "Aelira", role: "HEALER", ep: 1400, gp: 220, pr: 6.36, belowMin: false, me: true },
        { rank: 2, name: "Mira", character: "Mira", role: "DPS", ep: 900, gp: 400, pr: 2.25, belowMin: false, me: false }
      ]
    }
  ]
};

const day = 86_400_000;
const soon = new Date(Date.now() + 30 * 60_000).toISOString();
const later = new Date(Date.now() + 2 * day).toISOString();

export const sampleStandingsBody = {
  gameEdition: "forever",
  wowGuildName: "Northwind",
  updatedAt: "2026-11-03T18:00:00.000Z",
  nextRaid: {
    id: "raid-soon", title: "Barrow Deeps", scheduledAt: soon, core: "Thursday", coreId: "core-thu",
    players: [{ name: "Aelira-Stonehall", role: "HEALER" }, { name: "Borin-Stonehall", role: "TANK" }],
    maybe: ["Cindra-Stonehall"]
  },
  raids: [
    { id: "raid-soon", title: "Barrow Deeps", at: soon, core: "Thursday", note: "Bring flasks." },
    { id: "raid-later", title: "Emberfall Depths", at: later, core: "Sunday", note: "https://discord.com/events/100/200" }
  ],
  standings: [
    { character: "Aelira-Stonehall", realm: "Stonehall", main: true, ep: 1400, gp: 220, pr: 6.36 },
    { character: "Borin-Stonehall", realm: "Stonehall", main: false, ep: 800, gp: 300, pr: 2.67 },
    { character: "Mira-Stonehall", realm: "Stonehall", main: true, ep: 900, gp: 400, pr: 2.25 }
  ]
};
