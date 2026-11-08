# Discord text audit — 8 November 2026

Owner request (8 November): after removing #wow-personnage (replaced by #invitation-guilde), check that what Discord
and the bot say is still accurate, especially messages that name a channel.

Method: read-only. GET requests with the bot's token (channel lists, topics, pinned messages and the bot's own recent
posts, up to 100 messages per channel). Nothing was posted, edited or deleted. Québec Gold (QG) edits are for the
coordinator or owner to apply by hand. No member names or user IDs are kept in this file.

## Result in one paragraph

Every `<#channel>` mention and every `#name` in QG's topics and in the bot's posts points at a channel that exists.
QG's pinned guides are accurate about #invitation-guilde and the Classements category. Two things are out of date:
the leftover "Qui est qui" post (its board was removed in the code) and, on the test server, an old
#pvp-groups channel next to the merged group finder. The code and docs audit found and fixed a few more (below).

## Findings in Discord (action needed)

| # | Where | Problem | Suggested action |
| --- | --- | --- | --- |
| 1 | QG #guilded-guide, message [1568306639432458264](https://discord.com/channels/1323321076478119967/1555000342033203282/1568306639432458264) (unpinned) | "🪪 Qui est qui" board. The Who's who board was removed (PR #517), so this post is a frozen leftover that lists members' linked characters and will never update. | Delete this one message. |
| 2 | Test server #guilded-guide, message [1568594793058275399](https://discord.com/channels/1563959517337747556/1568580013002072134/1568594793058275399) in the guide channel | Same leftover "Qui est qui" post ("Aucun personnage lié pour l'instant"). | Delete (test server; safe). |
| 3 | Test server channel `pvp-groups` (category "⚔️ PvP · …") | The PvP groups channel was merged into the group finder (#619). The finder channel `recherche-de-groupe` is the one that works; `pvp-groups` is an empty leftover that `/setup` reports as stale. | Retire it with `/setup` → Retire an old channel (test server). QG never had it. |

Nothing else in QG named a channel that is gone. No QG topic or pin mentions #wow-personnage, #bot-faq or #pvp-groups.

## Checked and fine (QG)

- #guilded-guide pinned "Guilded — les outils de la gang" (message 1555381420241854565): links `<#…>` resolve to
  #donjons-termines, #classement-donjons, #course-au-60, #classement-duels, #statistiques-jcj, #bilan-hebdo-wow,
  #inscriptions-raid and #invitation-guilde. Step 3 correctly sends people without a guild invitation to
  #invitation-guilde.
- #guilded-guide "Bien commencer" (1555000344164175895) and "Installer Guilded en 1 minute" (1566964500110905518):
  no channel names; steps match `guilded.kcaron.top/start`.
- #invitation-guilde topic: correct (full in-game name, officer invites, ✅ when done).
- Topics of #wow-annonces, #guilded-annonces, #bilan-hebdo-wow, #candidatures-raid, #journal-officiers,
  #preparation-raid, #presences-raid, Communauté channels: every channel named exists.
- #candidatures-raid shows an application card with an "Availability" field (English word in a French server). It is
  the raid application form's own field name, not the hidden availability module. Optional follow-up: translate the
  field label for French servers.

## Worth a look (judgment call, not wrong)

- The pinned "Guilded · Informations actuelles" post is written by hand, not by code, so it can drift. It currently says
  "Version actuelle : 9.0.4" (correct) and "téléchargement direct (9.0.3, se met à jour seul)". The companion is
  9.0.4 now (`companion-app/package.json`). Suggested edit: drop the version number from the direct-download link
  ("téléchargement direct, se met à jour seul") so it cannot go stale again.
  EN: "or the [direct download](https://guilded.kcaron.top/companion/) (updates itself)".
- The guide has no line for the group finder (recherche de groupe) because QG has no finder channel. If QG adds one,
  add "Groupes : <#id>" under "Où voir les résultats".

## Fixed in the code and docs (this PR)

| File | Was | Now |
| --- | --- | --- |
| `docs/FEATURE_DISCOVERY_MAP.md` | linking and install help lived in "#bot-faq" | #invitation-guilde, #guilded-guide, `/help` |
| `site/pages/reference.md`, `reference.fr.md` | tab row "Standings · Crafting · Availability … who is online" (the availability module is hidden) | "Standings · Crafting" |
| `src/commands/pvp-group.ts` | error: "The PvP groups channel does not exist yet" (and FR "groupes JcJ") | "The group finder channel does not exist yet" / "Le salon de recherche de groupe n'existe pas encore" |
| `docs/BATTLEGROUNDS_NEXT_MODULE.md` | listed `pvp-groups` as a channel `/setup` creates | notes the merge into the group finder (since 9.0.4) |
| `tests/channel-names-in-text.test.ts` (new) | nothing stopped stale names | fails when bot strings, site pages, the member install guide, README or COMMANDS name a retired channel (#bot-faq, #wow-personnage, #pvp-groups, #groupes-pvp, #groupes-jcj) or a channel `/setup` does not create |

Left as is on purpose: internal code comments that mention #bot-faq or #wow-personnage (retire flow history),
`docs/GUILDED_SHARED_SUPPORT.md` (documents the #bot-faq retirement), the addon's "Availability" tab strings in
`Locale.lua` and `Minimap.lua` (module hidden, not a channel reference), and `src/setup-names.ts` still listing the
retired `bot-faq` spec (the retire flow needs it).

Repeat this audit after any channel is added, merged or retired: add the new name to `src/setup-names.ts` and the guard
test follows.
