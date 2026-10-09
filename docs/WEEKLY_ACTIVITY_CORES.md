# Weekly dungeon and PvP cores

Implementation branch: `codex/weekly-activity-cores`. Product version stays 6.0.0;
protocol stays 2. This feature is bot-only. Deployment and real Discord acceptance
are separate gates; source changes are not evidence of live availability.

## Commands

Use `/team` for weekly dungeon and PvP cores. `/core` continues to manage existing
raid cores. Both use the same weekly time parser and six-day signup window, but
teams have their own rosters, sessions and attendance. They never create raids,
EPGP transactions, loot pools, dungeon completion records or rating claims.

Leaders (the existing Raid Leader permission or higher) create a team in an
existing text channel. Choose a channel whose audience should see the roster,
signups and results; Guilded preserves that channel's permissions. It requires
View Channel, Send Messages, Embed Links and Read Message History there.

Example dungeon setup:

```text
/team create name:Thursday Crew kind:Dungeon channel:#dungeon-core schedule:thu 20h timezone:America/Toronto minutes:120 goal:Weekly gearing runs
/team member team:Thursday Crew player:@Ray action:Add / update role:Tank character:Ray
/team member team:Thursday Crew player:@Healer action:Add / update role:Healer character:HealerName
/team member team:Thursday Crew player:@Backup action:Add / update role:DPS bench:true character:BackupName
```

Discord presents choices in its command interface. Dungeon composition is
1 tank / 1 healer / 3 DPS. PvP defaults to 0 tanks / 3 healers / 7 DPS as an
editable starting template when creating a team, **not a claim about any
client's supported rated format**. Set `tanks`, `healers` and `dps` to suit your
server and activity (2–40 total slots). Describe format and goals in `goal`.
Rated modes and rating imports are not automatically detected.

Roster members must have their own linked character. If there is more than one,
specify its name, name-realm or ID. One person can join several teams and bring
a different character to each. Substitute status belongs to that team only.

## Each week

- Upcoming sessions appear automatically six days ahead, with local timezone
  and daylight-saving handling. The core roster is separate from these posts.
- Members press Tank, Healer or DPS to confirm; Absent and Tentative never occupy
  a slot. `/team respond` can choose a different owned character for one session.
- Regulars take priority, then substitutes, then outside recruits, ordered by
  confirmation time within each tier. A later regular confirmation can move a
  substitute to the waiting list. Declining frees a slot automatically.
- `/team session action:Open recruitment` allows other members who can view the
  team's channel to sign up. It does not broadcast into other channels or change
  permissions. Closing recruitment prevents new outsider confirmations;
  existing confirmations remain. Leaders can bench them if needed.
- `/team lineup` lets leaders select or bench an available player before start.
  A leader bench choice persists when the player changes roles or availability.
  Selecting a player cannot exceed the role cap; bench a selected player first.
- Confirming a session warns about overlapping confirmed **team** sessions.
  Raid-calendar conflicts are not included. This warning does not prohibit
  signing up, and later automatic promotions do not send a separate conflict DM.
- A durable reminder is queued in the hour before the session. It mentions up
  to 40 roster members/confirmed recruits, excluding people marked absent. The
  existing background-job cadence determines delivery time; no new timer is added.
- `/team session action:Start` closes confirmations and freezes the lineup.
  `/team attendance` records Present, Late, Absent or Benched individually.
  A signup is never treated as proof of attendance. No points are awarded.
- `/team session action:Complete result:...` saves the leader's optional summary.
  `/team view` displays attendance and results; `/team sessions history:true`
  lists recent sessions. Results are manually recorded, not verified game data.

French guilds receive French roster/session cards, buttons and main confirmations.
Commands are listed in `/help` and autocomplete only exposes teams whose channels
the requesting member can view. Command and button handlers recheck live channel
access; leadership is fetched again for management commands.

## Scheduling and archiving

`/team schedule` changes future generation. `schedule:off` pauses it. Already
published sessions retain their times and responses; cancel an individual session
with `/team session action:Cancel`. A cancelled occurrence is not regenerated.
Duration changes apply to new occurrences only.

`/team archive` stops generation and cancels outstanding planned/active sessions.
Completed sessions and attendance remain. It does not delete Discord channels,
roles, characters or SavedVariables. Archived team names remain reserved; history
is accessible through `/team show`, `/team sessions` and `/team view`.

This first implementation uses an existing channel rather than provisioning
roles/voice channels, native Discord scheduled events or a companion UI. Public
recruitment announcements in another channel and automatic match/run imports are
not included.

## Integration and release

Work was isolated from the other session's checkout in a managed worktree. New
implementation is in `activity-core.ts`, `activity-core-discord.ts` and `team.ts`.
Small integration changes exist in `src/main.ts` (handler, button/autocomplete
routes and existing repair job), `src/services/discord-jobs.ts` (three job kinds),
`src/commands/index.ts`, `src/commands/help.ts`, and the PostgreSQL verifier.
When merging with the approval/economy work, preserve its admission gate **before**
these interaction routes and preserve its job cadence/cost changes. Do not replace
either shared file wholesale. No hosted-pilot or point-attribution logic changed.

Apply additive migration `20261111090000_weekly_activity_cores`, generate Prisma,
and register `/team` through the normal bot deployment after CI and backup gates.
There is no addon/companion schema change and no version bump.

Offline tests cover role caps, regular/substitute priority, leader selection,
character ownership, guild isolation, session closure, schedule pause/cancellation,
explicit attendance, archival, Discord retries, stale reminders and private-channel
access. The existing PostgreSQL CI harness also exercises concurrent generation,
concurrent confirmations, transactional rollback, promotion and backup/restore.

Real Discord acceptance (not yet passed):

- [ ] Create one dungeon and one PvP team in the intended English/French channels.
- [ ] Add regulars and substitutes, each with their own character; test two clients.
- [ ] Fill one role, decline, and verify waiting-list promotion and leader selection.
- [ ] Open/close recruitment and verify inaccessible channels reveal no roster.
- [ ] Observe one scheduled reminder and a cancelled occurrence across a restart.
- [ ] Start, record actual attendance, complete, and inspect history.
- [ ] Confirm raid, loot, community points and the other session's approval flow
  retain their existing behavior.
