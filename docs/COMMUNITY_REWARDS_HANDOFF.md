# Community rewards — coordinated push handoff

Owner request, 9 October 2026: implement the community reward rebalance and
leave it for a combined push with the other active session. **Do not push,
merge or deploy these changes separately.** No version bump.

Status: READY FOR COMBINED PUSH; local validation passed. Changes
are uncommitted in the shared checkout on `codex/pilot-owner-approvals`.
Preserve these edits when combining work. This session will not push or deploy.

Approved schedule:

| Source | New rule |
| --- | --- |
| Voice | 4 points / 15 minutes, 120 minutes/day = 32 points/day |
| Messages | Unchanged: 1 point, 10/day, five-minute cooldown |
| Reactions | Unchanged: 1 point, 6/day, existing abuse protections |
| Approved helping | 15 per approved nomination, up to 45/week |
| Gaming night | 25 points by default for confirmed attendance |
| Cooperative challenge | 30 points by default after approval |
| Daily dice | 2 points plus 3 for a roll of 90–100 |

Existing ledgers and activity promises must remain intact. No production
reward changes are being applied in this session. The earlier mistaken
120-minute configuration change was reverted; production voice was restored
to its original 240-minute / 2-points-per-block setting.

## What changes on deployment

- Helping: future approvals award 15 points, with three approvals per member
  per week (maximum 45). Existing approvals still consume a weekly slot;
  reversals do not reopen slots. Old rewards are not recalculated.
- Gaming/challenges: new organizer forms and optional slash-command `points`
  use defaults of 25/30. Explicit custom values remain supported; existing
  activities retain their stored amounts. Quiz rewards are unchanged.
- Dice: newly created daily rounds store 2 participation points plus a 3-point
  bonus at 90–100. An already-created round retains its old rules for everyone
  that day, including members who have not rolled yet. Replies show the saved
  round reward; repeated clicks never award again. Hub and podium text updated.
- Voice: the new `voice-points` option controls points per 15-minute block.
  Missing settings retain the legacy rate of 2, so deploying alone does NOT
  activate the requested 120-minute / 32-point profile. No migration is needed;
  the new setting lives in the existing rules JSON.

## Combined rollout (other session)

1. Include all files below in the coordinated review/push, preserving the
   other session's changes. Keep product version 6.0.0 and protocol 2.
2. Run final combined checks and the usual release preparation, green
   PostgreSQL/Windows CI, ledger preflight and verified-backup gates from
   `V5_0_RELEASE_HANDOFF.md`. Deploy the existing Oracle service only.
3. Re-register slash commands: participation gains `voice-points`, and gaming
   and challenge creation now accept omitted `points`.
4. Only AFTER the new bot code is live, configure Quebec Gold's active Discord
   season. At inspection it was `cmuq9jdgk0026ntcaj5sy7jo8` (Octobre 2026);
   recheck the active season rather than assuming it has not rolled over:

   ```text
   /participation settings season:SAISON voice-minutes:120 voice-points:4
   ```

   Preserve all other participation rules and enabled state. Do not apply
   this JSON against the old bot: it ignores the new rate and would still
   award only 16 points in two hours. Monthly rollover copies the new rules.
5. Verify `/participation settings` and `status` show 4 pts / 15 min and
   120 minutes. Previously earned points/time remain; only newly completed
   blocks receive the new rate, so the transition day can total less than 32.
6. Verify refreshed hub/podium wording, a new round's dice reward and replay,
   a reviewed helper reward/reversal, and 25/30 prefilled organizer forms.
   Do not create fictitious production rewards to verify this. Real Discord
   behavior remains a separate acceptance check.

## Files belonging to this change

- `src/services/participation-rules.ts`
- `src/services/participation.ts`
- `src/commands/participation.ts`
- `src/services/community-rules.ts`
- `src/services/community.ts`
- `src/services/community-panels.ts`
- `src/services/community-leaderboard.ts`
- `src/commands/community.ts`
- `src/commands/community-hub.ts`
- `tests/participation.test.ts`
- `tests/community.test.ts`
- `tests/community-interactions.test.ts`
- `scripts/verify-participation-postgres.ts`
- `docs/DISCORD_PARTICIPATION.md`
- `docs/COMMUNITY_ACTIVITIES.md`
- `docs/COMMUNITY_REWARDS_HANDOFF.md`

## Validation

9 October 2026 local results:

- `npx tsc --noEmit -p .` passed.
- `npx vitest run` passed: 162 files / 1,313 tests.
- After the final podium wording change, the leaderboard/experience suites
  passed again: 2 files / 23 tests.
- `npx eslint .` passed, including after the final wording change.
- `node addon/Guilded/validate-addon.mjs` passed.
- `git diff --check` passed.

These results cover the shared checkout at validation time, not a future
combined commit; rerun the required checks after integrating the other work.

The PostgreSQL rehearsal script now also checks
concurrent 4-point voice checkpoints at the two-hour cap and a 15-point helper
award; it has not been run against PostgreSQL in this session. Windows CI,
release packaging, deployment and live acceptance are not claimed passed.
