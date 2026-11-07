// Fictional guild used by "Look at a sample guild". It is not a Discord account and it
// never leaves the phone. The same parsers that read the live API read this payload.

export const sampleHubBody = {
  me: { officer: false, raidLeader: false },
  updatedAt: "2026-11-03T18:00:00.000Z",
  guild: { name: "Northwind", edition: "forever" },
  link: { battleNet: true, characters: true, battleTag: "Northwind#1234" },
  characters: [
    {
      id: "char-aelira", name: "Aelira", displayName: null, realm: "Silvermoon", className: "Shaman", spec: "Restoration", level: 80,
      isMain: true, edition: "forever", rank: "Raider",
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: [{ id: "core-thu", name: "Thursday", role: "HEALER", bench: false, trial: false, backup: false, lootMode: "RESERVE" }]
    },
    {
      id: "char-borin", name: "Borin", displayName: null, realm: "Silvermoon", className: "Warrior", spec: "Protection", level: 80,
      isMain: false, edition: "forever", rank: "Raider",
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: [{ id: "core-thu", name: "Thursday", role: "TANK", bench: true, trial: false, backup: false, lootMode: "RESERVE" }]
    },
    {
      id: "char-cindra", name: "Cindra", displayName: null, realm: "Silvermoon", className: "Mage", spec: "Frost", level: 78,
      isMain: false, edition: "forever", rank: null,
      guild: { name: "Northwind", edition: "forever", current: true, discordId: "100", serverName: "Northwind" },
      cores: []
    }
  ],
  reserves: {
    writable: false,
    list: { active: true, open: true, title: "Barrow Deeps", perPlayer: 2, keeper: "officer", syncedAt: "2026-11-03T17:40:00.000Z" },
    items: [
      { itemId: 1, itemName: "Ashkandi, Greatsword of the Brotherhood", characters: ["Aelira"], mine: true },
      { itemId: 2, itemName: "Thunderfury, Blessed Blade of the Windseeker", characters: ["Mira"], mine: false }
    ],
    mineCount: 1,
    cores: [
      { id: "core-thu", name: "Thursday", lootMode: "RESERVE", reservesPerPlayer: 2 },
      { id: "core-sun", name: "Sunday", lootMode: "EPGP", reservesPerPlayer: 1 }
    ]
  }
};

export const sampleManageBody = {
  me: { officer: false, raidLeader: false },
  updatedAt: "2026-11-03T18:00:00.000Z",
  edition: "forever",
  guildName: "Northwind",
  characters: [
    {
      id: "char-aelira", name: "Aelira", displayName: null, realm: "Silvermoon", className: "Shaman", isMain: true,
      wishlist: [{ itemName: "Sulfuras, Hand of Ragnaros", priority: 1 }, { itemName: "Spineshatter", priority: 2 }]
    },
    {
      id: "char-borin", name: "Borin", displayName: null, realm: "Silvermoon", className: "Warrior", isMain: false,
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
    players: [{ name: "Aelira-Silvermoon", role: "HEALER" }, { name: "Borin-Silvermoon", role: "TANK" }],
    maybe: ["Cindra-Silvermoon"]
  },
  raids: [
    { id: "raid-soon", title: "Barrow Deeps", at: soon, core: "Thursday", note: "Bring flasks." },
    { id: "raid-later", title: "Hyjal Summit", at: later, core: "Sunday", note: "https://discord.com/events/100/200" }
  ],
  standings: [
    { character: "Aelira-Silvermoon", realm: "Silvermoon", main: true, ep: 1400, gp: 220, pr: 6.36 },
    { character: "Borin-Silvermoon", realm: "Silvermoon", main: false, ep: 800, gp: 300, pr: 2.67 },
    { character: "Mira-Silvermoon", realm: "Silvermoon", main: true, ep: 900, gp: 400, pr: 2.25 }
  ]
};
