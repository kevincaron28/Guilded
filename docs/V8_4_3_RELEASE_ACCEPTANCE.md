# 8.4.3 acceptance — 4 November 2026

Status: prepared 4 November 2026 from main plus the Forever launch fixes only. Deploying
the bot would post a one-time update notice to every guild; the Worker fix deploys on a
main merge and does not need a bot release.

- [ ] Final-commit CI green on the release PR.
- [ ] Worker deployed; standings polls return 304 with no 502 in the companion log.
- [ ] `npm run addon:editions` then `npm run addon:verify-editions` pass on the release commit.
- [ ] Unsigned Store package 8.4.3.0 built from the PR commit; identity checked
  (Kcaron.GuildedCompanion, runFullTrust, x64); packaged renderer started with no errors.
- [ ] Partner Center submission, certification and publication (owner).
- [ ] Real-client check on a PC with beta and Forever folders: Find my saved data switches to Forever (not run).

8.4.2 records ([8.4.2](V8_4_2_RELEASE_ACCEPTANCE.md)) are unchanged.
