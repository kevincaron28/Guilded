# PoE2 in Quebec Gold — integration proposal

2 October 2026. Scope confirmed by the owner: **the existing PoE2 area in Quebec
Gold**, not another server. This is analysis; no PoE2 channels/settings were changed.

## Recommendation

Reuse the `Path of Exile 2` role and existing categories. Add only two bot-managed
channels under the main PoE2 category: **🧭・poe-compagnon** for setup and private
actions, and **🗺️・mapping-stats** for an opt-in league/mode activity board. Reuse
`🏹map-clearing` for groups and reviewed challenges, `👹boss-kill` for boss groups,
and the existing Party voice rooms. A separate challenge leaderboard can wait for
actual demand; navigation should not require another large category.

Keep mapping observations and competition points clearly distinguished. Observing
an instance or spending time there does not verify that it was completed.

## Live inventory

Read-only Discord channel/role inspection plus aggregate database queries found:

| Existing area | Category ID | Reuse |
| --- | --- | --- |
| ━━ 🔥 PATH OF EXILE 2 🔥 ━━ | `1552242460225306674` | Place the two new channels here; retain announcements, patch notes, streamer hub, names, lotto and useful links. |
| ⬛Chat Room PoE 2⬛ | `1324495907932213248` | General chat and `🤝question-aide` remain the discussion/support area. |
| ⬛Show-off PoE 2⬛ | `1325249486045581405` | Keep `💎drops`, `📊builds` and hideouts; avoid mixing showcase posts into statistics. |
| ⬛Looking For Group PoE 2⬛ | `1326343865191370869` | Keep exp boost, map clearing and boss groups. |
| ⬛Voice PoE 2⬛ | `1325249792586027071` | Keep Main, Party 1–3 and the separately restricted officer room. |
| ⬛Trade PoE 2⬛ | `1326341360617521172` | Keep trading and price checking separate from points/review. |

Existing role: `Path of Exile 2`, **`1552238940789149776`**, not integration-managed.
The inspected areas deny View Channel to everyone and allow the PoE2 role, with
additional exceptions in some categories. The officer voice has its own access.
These are explicit overwrite observations, not proof of every member's effective
permissions. Preserve role acceptance rules and inspect effective access before setup.

At inspection, **tracking was disabled**, there were **zero mapping observations**,
and **zero PoE2 community seasons**. There is no usage baseline to rank or populate.
Do not interpret a quiet/empty board as zero player activity in the game.

## Channel and role mapping

| Destination | Binding | Panel/actions |
| --- | --- | --- |
| New 🧭・poe-compagnon | Main category `1552242460225306674` | `Lier mon compagnon`, `Mon suivi`, `Mes cartes`, `Mes statistiques`, `Aide`. Pairing codes and personal results are private. |
| New 🗺️・mapping-stats | Same main category; member read-only, bot write | One edited board with selected league/mode/period and freshness; `Mes statistiques`, `Choisir une ligue`, `Défis et groupes`. |
| Existing 🏹map-clearing | `1326366196047810580` | Event signup cards, group requests and reviewed mapping challenges; link to relevant Party voice. |
| Existing 👹boss-kill | `1326366293166919711` | Boss group signup and proof reviewed by an organizer; no inferred kill credit from logs. |
| Existing 🤝question-aide | `1324497427985596497` | Setup help and declared-build discussion. |
| Existing 📊builds / 💎drops | `1326342970907299951` / `1326342889449455648` | Link member-shared builds and evidence; do not scrape or publish private stash data. |
| Existing Party 1 / 2 / 3 | `1325250358083194902` / `1325250451817500693` / `1325250543735541963` | Native scheduled-event venues only after matching-audience verification. |

Proposed persistent guild bindings: `poeRoleId`, `poeHubChannelId`,
`poeStatsChannelId`, `poeStatsMessageId`, `poeGroupChannelId`, selected league/mode
and public-stats enablement. Store IDs after selection; do not rediscover by names
on every refresh. Add names/topics to `src/setup-names.ts`, following the existing
managed-channel pattern. A setup preview should distinguish reuse, creation and
permission changes and refuse ambiguous/foreign-server selections.

New channels should preserve the main category's role visibility and acceptance
requirements. Set only the statistics channel read-only. Keep bot View Channel,
Send Messages, Embed Links, Read Message History and Pin Messages as needed; do
not give the PoE2 role officer authority or grant everyone access. Recheck live
membership and channel access for every shared-data action, including autocomplete.

## What the module can already provide

`/poe setup`, `/poe pair`, `/poe status`, `/poe runs` and `/poe summary` exist and
reply privately. The companion accepts individual pairing credentials and explicit
PoE2 log-tracking opt-in. It can run without WoW. Personal visits and summaries
already filter declared league and mode; known league names autocomplete.

`/poe summary guild:true` can currently return a guild aggregate to a guild member;
it is not presently bound to the PoE2 role. A new role-restricted public board needs
matching server-side checks on queries/autocomplete, not only hidden channels.
Keep personal history available to its owner according to existing account policy;
role loss must stop access to other members' shared PoE2 statistics.

Separate companion work in the owner’s development checkout adds local daily/current-map
displays and recovery diagnostics; it is not included in this bot release. Discord
currently receives ended observations. See [POE2_MAPPING.md](POE2_MAPPING.md). A Discord
board must not claim it shows each member’s current map or online status.

## Statistics to show

| Metric | Definition / display constraint |
| --- | --- |
| Observed map instances | Distinct `(member, instanceRef)` within selected league/mode and time window. Label as observed activity. |
| Portal entries | Uploaded visit count. One instance entered twice is one observed map and two visits. |
| Recorded time | Sum of non-null visit durations; display the number of timed visits and unknown-duration visits. Loading/idle time can be included. |
| Participating members | Distinct eligible opted-in members with observations, with no implication about the whole server. |
| Last observation / last receipt | Use gameplay timestamps separately from `PoeMapVisit.createdAt` (server receipt). An old offline upload must not appear to be fresh gameplay. |
| Personal history | Private last visits and 7/30-day trends, with declared character/league/mode visible to the owner. |

Legacy visits without `instanceRef` each currently count as a map. Expose an
unknown-instance count/quality note rather than presenting these as deduplicated.
The existing summary returns only the top 15 members: do not sum those rows to claim
guild totals. Add a dedicated aggregate across all eligible records and separate
pagination for rankings. Summing per-member maps counts participation in instances,
not unique party-wide maps; no shared instance identifier is verified for that purpose.

League and mode must be explicit on every shared board. Use observed names and a
configured selection; do not guess the current league from a release announcement.
Never mix Standard, seasonal leagues, Hardcore, Softcore or SSF standings. Keep
Discord community seasons independent from game leagues and PoE2 competitions.

Not currently evidenced: verified clears, boss kills, deaths, XP/hour, loot value,
currency profit, full Atlas completion or verified character ownership. Do not award
automatic competition points or show success-rate/profit charts from timing alone.

## Member journey and publishing

1. A member with existing PoE2 access opens the companion hub and gets a private
   pairing code, or reuses the companion's current personal link.
2. They enable tracking and choose the log, character, league and mode themselves.
   Explain that these identity fields are declared and what is shared with the guild.
3. Private `Mon suivi` distinguishes guild tracking paused, no observations and last
   received observation. File-path/encoding diagnostics stay in the companion;
   Discord cannot inspect the member's PC.
4. Before publishing named activity on the new board, offer a separate sharing
   choice scoped to the PoE2 area. Store that preference and filter the board and
   its drill-downs consistently. Existing upload consent is not a new public-ranking
   consent. Pausing tracking and hiding an existing public row are distinct controls.
5. Edit one pinned board every five minutes, and only when content changes. Use
   private selector results instead of letting any member change the shared default
   league. No automatic role pings. Hide stale/departed/non-consenting members on refresh.

Suggested empty state: “Aucune observation partagée pour cette ligue. Lie ton
compagnon pour commencer; seules les nouvelles visites capturées seront comptées.”
Keep an independent-GGG notice on the hub and stats.

## Competitions and seasons

The new community numbering supports a separate PoE2 sequence, for example
`Saison 1 — Expédition de la guilde`. Start it with the existing PoE2 role and
anchor it in `🏹map-clearing`; keep reviewed evidence and points in the existing
community ledger. The existing private `/community hub` can expose its challenges,
signups, points and archives. Dice/quiz remain Discord-season activities.

Initial challenges should use officer-reviewed screenshots/video or confirmed event
attendance, with stated league/mode and eligibility. Keep mapping activity totals
separate from these reviewed points. Do not treat volume of log rows as proof.
PoE currency lotteries still require an organizer-confirmed in-game payment.

Current service logic allows only **one active community season per game per guild**.
It does not enforce league/mode on PoE2 challenge claims. Start with one clearly
scoped competition. Before parallel league/mode competitions, add structured scope
fields and server-side eligibility checks, then revise the active-season lock/query
and all standings keys. A season name alone is not sufficient isolation.

## Delivery phases and acceptance

**First: connect and verify.** Complete the release/real-client gates for the existing
module, then create/reuse the two bound channels and publish the hub. Start with a
small volunteer group, tracking opt-in and private statistics. Verify real current-patch
English/French log behavior; no real local log was available during the reader audit.

**Second: shared stats.** Implement role checks, separate publication preference,
all-member aggregates, freshness/quality labels, league/mode selectors and a durable
single-message refresh. Test role loss, rejected consent, changed channel permissions,
offline upload, missing duration and repeated upload. Verify one map entered twice,
another instance, and two players in a party without overstating unique guild maps.

**Third: activities.** Launch one reviewed PoE2 season and scheduled group events in
existing channels. Measure weekly opted-in uploaders, repeat activity participation,
unknown-instance/timing rates and organizers' review backlog. Decide on a dedicated
`🏆・défis-poe2` channel only if the reused group channel becomes crowded.

Backend work should extend `src/commands/poe.ts`, `src/services/poe-mapping.ts`,
setup names/configuration, autocomplete authorization and a new persistent panel
publisher. Extract reusable private PoE replies before adding buttons; avoid separate
implementations with different role/consent rules. Schema changes require additive
migrations and PostgreSQL checks. No game automation or global upload token is needed.

## Research constraints

GGG explicitly permits reading logs when the user understands the use of the data;
its current developer page says new application registrations cannot be processed.
Keep the initial integration on the existing consent-based companion rather than
depending on a newly registered OAuth client. Retain the independent-product notice.
[GGG developer policy and registration](https://www.pathofexile.com/developer/docs).

The official API reference states PoE2 coverage is limited. No documented per-map
completion stream was found in that reference; this is a research finding, not proof
that all future API additions will lack it. Character/account snapshots do not
establish individual run completion. Recheck supported resources before adding any
API-based feature. [GGG API reference](https://www.pathofexile.com/developer/docs/reference).
