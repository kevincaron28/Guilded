# Raid presets by edition — checked 26 October 2026

`/raid create preset:` and the core planner's **Size & roles** menu now offer each edition's
named raids, plus the generic 10/20/25/30/40 sizes everywhere. The list comes from
`src/services/raid-presets.ts`. A preset only fills seat counts; officers can still edit them.

Each named raid uses the generic role split for its size (10: 2/2/6, 20: 2/4/14, 25: 2/5/18,
40: 2/8/30). That split is a starting point, not a recommendation for that raid. No encounter
IDs, boss lists, loot or GP values are added here.

| Edition | Named presets | Notes |
| --- | --- | --- |
| Forever | Barrow Deeps (10), Hyjal Summit (20), Onyxia's Lair (40) | Unchanged. Loot: [Forever raid loot](FOREVER_RAID_LOOT_2026-10-25.md). |
| Classic Era / Hardcore | Molten Core, Onyxia's Lair, Blackwing Lair, Temple of Ahn'Qiraj, Naxxramas (40); Zul'Gurub, Ruins of Ahn'Qiraj (20) | Every Classic raid is open on Era. Season of Discovery sizes differ and do not apply. |
| TBC Anniversary | Karazhan, Zul'Aman (10); Gruul's Lair, Magtheridon's Lair, Serpentshrine Cavern, Tempest Keep: The Eye, Hyjal Summit, Black Temple (25) | Zul'Aman opened 22 October 2026. Add Sunwell Plateau (25) when Blizzard opens it; no date is announced. |
| Mists Classic | Mogu'shan Vaults, Heart of Fear, Terrace of Endless Spring, Throne of Thunder, Siege of Orgrimmar — each as 10 and 25 | Siege of Orgrimmar opened 4 June 2026 (final phase). Flexible Siege groups use a generic size. |
| Retail | None | Midnight raids are flexible (10–30) outside Mythic (20) and change every season, so Retail keeps the generic sizes and the planner's Flexible entry. |

Typing a raid name in `preset:` works when it names one preset (for Mists, add the size:
`Siege of Orgrimmar (25)`). A Forever-only preset is refused on other editions, as before.

## Keeping it current

- TBC: add `preset("sunwell", "Sunwell Plateau", 25, TBC)` when the phase opens.
- Each edition's list must stay at 20 presets or fewer: the core planner adds five sizes
  (and Retail's Flexible entry) to one 25-option Discord menu. `tests/raid-presets.test.ts`
  checks this.

## Sources (checked 26 October 2026)

- Classic raid sizes: [Warcraft Tavern — Classic raids overview](https://www.warcrafttavern.com/wow-classic/guides/raids/),
  [Wowpedia — Raid areas](https://wowpedia.fandom.com/wiki/Game_Guide/Raid_Areas).
- TBC Anniversary phases: [Warcraft Tavern — TBC phases](https://www.warcrafttavern.com/tbc/guides/phases/);
  Zul'Aman on 22 October: [Blizzard forums — BCCA: Face the Gods of Zul'Aman on October 22](https://us.forums.blizzard.com/en/wow/t/2376214),
  [Icy Veins](https://www.icy-veins.com/wow-classic/news/face-the-gods-of-zulaman-on-october-22-in-burning-crusade-classic-anniversary/).
- Mists Classic: [Blizzard — Terrace of Endless Spring (10/25, Normal/Heroic)](https://news.blizzard.com/en-us/article/24223022/mists-of-pandaria-classic-enter-the-terrace-of-endless-spring-raid-now),
  [Warcraft Tavern — MoP raids](https://warcrafttavern.com/mop/guides/raids),
  [WoW Classic devs — Siege of Orgrimmar unlocks 4 June](https://x.com/wowclassicdevs/status/2054960497137738037).
- Retail: [Blizzard — Midnight Season 2 is live](https://news.blizzard.com/en-us/article/24294369/midnight-season-2-is-now-live).
