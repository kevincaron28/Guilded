# Run sharing between parties from different guilds (14 November 2026)

When a dungeon party mixes guilds, every registered guild with a member in the run gets that run on its own board (its member's score) and a run card in its own dungeon channel, with the other players' guild names. The public boards show the run once, as before.

## What exists

- **Guild lane.** A guild stores a run through its own import: its season and rules, points only for its own members, one run per guild and run id.
- **Public lane.** One row per run on the public boards, whoever sends it. Runs carried through a party (#880) go there.
- **Per-player guild text** (9.3.0): each player of a run carries the guild name the addon saw, shown on the card.
- **Parked guilds** (#856) and **one witness is enough** (#872).

## What this adds

A run that one lane has stored, or the public relay has placed, is offered to every other registered guild that has a member in it:

1. A guild is found from its own roster only: one of its characters matches a player of the run by full name and is in the guild's in-game roster. What a run says about guilds is never used to pick one. A guild with sharing switched off, or without a Discord server the bot is in, is left out. Guilds are taken in a fixed order.
2. The receiving guild handles the copy like a run one of its players' PCs reported: its own season window (judged from when the bot first received the run), its own checks, its own review list (officers see and release held runs with `/officer dungeon flagged`), points only for its own members, its own receipts. Only that guild's own roster members are marked as guildmates in its copy.
3. A run the receiving guild already holds, holds for review, or whose sending PC its officers excluded, is not copied again. A run that was held where it came from is not copied until it is released there.
4. The run card goes to the receiving guild's own dungeon channel through the same posting path and pace as its own runs, under its own dungeon channel and callout settings. A guild with no dungeon channel, or without a card allowance left, stores the run without a card.
5. Only character names, classes, levels and guild names appear on a copy. Nothing that identifies a Discord account goes from one guild to another.

## Officer switch

`/dungeon records other-guilds:false` stops a guild from receiving runs made with other guilds; runs already received stay. The switch controls receiving only: it does not change what other guilds receive from that guild's members. On by default. Changes are logged like the other officer settings. The same command's `announce` option can be given in the same call.

## Owner decisions (14 November 2026)

1. Sharing is on by default for every server, with the officer switch above.
2. One player's report is enough to give another guild its copy.
3. The other guild's dungeon channel gets the run card too, for runs from every route (signed upload, officer import, device upload, party relay).

## Needs an addon or companion release

- The companion can tell the bot which guild names a party showed, as a hint only (the roster stays the evidence).
- The addon can read each player's guild more reliably in a party; this improves card text only.
- Addon-only players in a mixed party already reach the public boards through #880; they reach their guild's board through this once the addon with the group relay ships.
