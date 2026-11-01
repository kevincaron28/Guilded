# Features prepared while the game is unavailable

These features shipped in 7.3.2 on 25 October, under the owner's
[release decision](RELEASE_DECISION_2026-10-25.md). The descriptions below record
implementation and outstanding acceptance separately. Game checks remain pending;
see the [current gap audit](RELEASE_GAPS_2026-10-25.md).

## Raid planning

`/lead create ... preset:barrow`, `preset:hyjal` or `preset:onyxia` fills suggested
role seats. Explicit `tanks`, `healers` and `dps` values override the preset;
without a preset the existing core defaults still apply. No title guessing,
boss list, loot prices, launch date or existing core/raid is changed.

In `/core setup` or `/core edit`, choose **Size & roles**, then a named preset.
Review or edit the prefilled roles before submitting. The existing form requires
the roles to add up to the selected size. Only future raids inherit saved core
changes; already published raids are preserved.

| Planning preset | Size | Tanks | Healers | DPS |
| --- | ---: | ---: | ---: | ---: |
| Barrow Deeps | 10 | 2 | 2 | 6 |
| Hyjal Summit | 20 | 2 | 4 | 14 |
| Onyxia's Lair | 40 | 2 | 8 | 30 |

These are editable guild planning suggestions, not verified encounter compositions.
Loot data and a real two-officer raid rehearsal remain separate raid-readiness work.

## Raid signup layout

New signup posts use Discord Components V2. They retain role buttons, Maybe,
Cancel, waitlists, core priority and the same signup records. Every role/count
and roster-section heading remains visible within the text budget; large lists
are shortened with a pointer to `/raid roster`. Closed raids have no signup buttons.

Existing embed posts keep their layout and message links. When a mirror must be
created, the new mirror may use V2 while the old message remains an embed; both
update the same roster. No existing message is converted irreversibly.

Before deployment, verify new and existing posts in a disposable Discord guild:
ordinary member signup, character picker, Maybe, Cancel, full-role waitlist,
promotion, both mirrors and raid closure, in English and French. This needs
Discord accounts/roles, but no game client. Automated tests are not recorded as
that human walkthrough.

Implementation follows [Discord's component guidance](https://github.com/discord/discord-api-docs/blob/main/developers/components/overview.mdx).

## Public score images

Public character pages now link to a downloadable 1200×630 PNG and use it in
social preview metadata. Scores remain separate by bracket and season. Recent
run links open `/leaderboards/run/<id>` with a shareable run page and PNG. Only
accepted public runs can be looked up; hidden/rejected/missing runs return 404.
Player-profile visibility and character leaderboards retain their existing rules.

Images show time/score, season, confirmation context and provisional/community
labels. Unknown routes remain unrated. Old evidence is identified. They use
the same scoring code as the pages, escaped text and the bundled licensed font;
they do not fetch remote images or fonts. Rendering has bounded caching and
concurrency. Visibility is checked before serving a cached run image, and image
responses are not cached by browsers/proxies. A social platform may retain a
preview after it has fetched it; its cache is outside Guilded's control.

The PNG renderer uses [Sharp's text input](https://sharp.pixelplumbing.com/api-constructor/).
Actual Discord link unfurling needs a reachable deployment; local PNG and
metadata checks alone do not prove that external-platform behavior.

## Why the companion logged a sync every two minutes

The bot's standings cache refreshes every 120 seconds. Its response contains
`publicRaids.fetchedAt`, which changes on each refresh even when EP/GP does not.
The companion writes this timestamp into the same Standings.lua file and used
to describe every rewrite as an EPGP update.

Timestamp-only refreshes are now silent. They still update both the main and
backup data files, because public raid vacancies expire after ten minutes in
the addon. Actual data changes and missing-file repairs still log, now as
“Updated addon data”. Network polling and freshness protection are preserved.
This fix must be installed in the companion before its current log changes.

## Remaining evidence and scope

Before game access: finish the human Discord walkthrough and verify external
link previews on a controlled deployment. Signing requires an owner-controlled
signing identity; native German/Spanish review needs reviewers. Neither is
silently marked complete. Do not invent encounter IDs or loot/GP tables.

When the game opens: follow [the game checklist](V7_3_2_GAME_CHECKLIST.md), including
live folder/Interface detection, first-combat and completion evidence, two-PC
sync/deduplication/recovery, standalone mode and French UI. Capture route data
as players reach the relevant dungeons. Keep unverified routes unrated, and
gather representative runs before calibration without rewriting frozen targets.

The existing test kit from commit `1d4789a` does not contain these newer features.
Use a newly built manifest/hash for this branch, and repeat affected acceptance.
