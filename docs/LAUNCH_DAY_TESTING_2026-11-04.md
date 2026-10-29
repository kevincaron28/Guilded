# November 4 player testing and bug response

Use the published launch build for your WoW edition. Game opening is currently
scheduled for 6 p.m. Toronto/Montréal (23:00 UTC); recheck the official time on
the day. You can test installation and the companion before the game opens.

## Before playing

- Keep a copy of your existing SavedVariables before installing a new build.
- Record your addon version (`/guilded version`), WoW edition/build and language.
- If using the companion, record its version and confirm the selected profile,
  guild, edition and watched saved-file folder.
- Guilded works without Discord or the companion. Test that route separately
  from optional connected features.

## Already checked on the owner's PC (29 October)

Done without the game running; do not repeat these. Evidence and the replaced
Retail files: `backups/launch-checks-2026-10-29/` (local only).

- Guilded and Guilded Dungeons 8.0.2 are installed for **Forever** (`_forever_`,
  interface 16001, matching the installed 1.60.1 client) and **Retail** (`_retail_`,
  120105, replacing 8.0.0). The local zips match the GitHub v8.0.2 hashes.
- The companion is 8.0.2.0 and holds a personal credential. Its old DuckDNS upload
  address is redirected to `guilded.kcaron.top` by the companion itself.
- Bug inbox: no member reports; the four logged bot errors all predate 8.0.x.

**Still to do on this PC on launch day:** the companion still watches the closed
Classic Beta file (realm "Classic Beta PvP"). After the first Forever login and
`/reload`, choose `_forever_\WTF\Account\<account>\SavedVariables` in the companion
and set the realm. The checks below still need the game.

## First session

Record PASS, FAIL or NOT RUN for each applicable row. A pass on one edition or
PC does not certify another. Use a test core/session for awards and destructive
recovery experiments; do not create fake points in the live competition.

| Check | Expected result | Result / report reference |
| --- | --- | --- |
| Load, open main pages, reload and relog | No Guilded Lua error; existing settings/data remain | |
| English/French and chosen UI scale | Buttons and important text remain readable and usable | |
| Standalone setup | Useful addon pages work with no companion/bot connection | |
| Member versus officer | Member sees appropriate tools; protected writes require officer authority | |
| Optional companion sign-in and folder selection | Correct account/guild/edition; saved data actually uploads after the game saves | |
| Offline then reconnect | Pending data retries without lost or duplicated ledger records | |
| Two-PC/officer sync | Both clients converge on the same authorized changes after reload/reconnect | |
| Crafting, readiness and sharing | Data is correctly attributed and freshness/consent are respected | |
| Dungeon completion | Correct party/dungeon; one completion; understandable local/accepted status | |
| Dungeon abandon/reset/reload | No invented completion or duplicate award | |
| Loot/council/reserves in a test session | Correct recipients, one award, expected GP and retained history | |
| RCLC/Gargul historical import in a disposable setup | Correct source/character mapping; preview before typed confirmation; no live awards or GP changed | |
| Repeat historical import, reload and undo | Records survive reload, stable IDs do not duplicate, last-batch undo preserves earlier history | |
| Backup preview, restore and undo in a disposable test setup | Scope is clear; original backup remains usable | |
| Other installed addons | Repeat a failed action with only Guilded enabled; record the difference | |

Forever raid encounters and loot data cannot be accepted from a November 4
leveling session. Schedule those checks when the content is available.

## Reporting a problem

Use `/report bug` in Discord and retain the short reference. Include a screenshot
only when useful and review what the report will share. For addon-only testing,
send the same details to the maintainer through the agreed support channel.

```text
Edition / game build:
Addon version / companion version (if used):
Language / UI scale:
Member or officer / standalone or connected:
What I did (numbered steps):
What I expected:
What happened:
Exact error text or relevant screenshot:
Does it happen again? Does it happen with other addons disabled?
Did reload/relog change it?
Report reference:
```

Do not post whole account/configuration files or an entire guild's SavedVariables
in a public report. Supply the smallest relevant example when the maintainer
requests it. Keep originals so a failure can be investigated without losing data.

## Maintainer response

1. Refresh `npm run bugs` from the corrected audit checkout. Notice incomplete
   inbox warnings; inspect the appropriate date window before concluding there
   are no unresolved reports. Health checks must include companion scripts and
   dynamic pages, not only `/health`.
2. Reproduce and assign severity: data loss/unauthorized access first, then
   startup or blocked sync, then incorrect workflows, then cosmetic issues.
3. Save a minimal failing example, implement a focused correction and run its
   regression plus the repository's required release checks.
4. Use the normal CI, ledger, backup, one-bot deployment and provider gates.
   Client changes receive a deliberate new version; published bytes stay intact.
5. Ask the affected tester to retry the matching fixed version. Record that
   result before resolving the report. A unit-test pass alone is not a player's
   confirmation.

Hourly scheduled follow-ups supplement active launch support. They cannot
simulate gameplay or promise immediate detection between checks.
