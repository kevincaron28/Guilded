# Next-session handoff — Guilded 7.4.0

## Owner decision

The final 25 October request explicitly authorized pushing and publishing the
entire reviewed bundle. This supersedes all earlier local-only holds. Keep
unavailable game tests as follow-up, not successful checks. Protocol stays 2.

## Included work

Roster/crafter/team/history/group pages, native bulk roster actions, GRM local
history migration, edition buff coverage, native client shortcuts and opt-in
availability/Retail key sharing are implemented. See
[the bundle review](LOCAL_BUNDLE_REVIEW_2026-10-25.md) and
[feature instructions](LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md).
Claude commits 816c7af (PR #222) and b9fd62c (PR #223) are included; later core
authorization, paging and atomic backup fixes deliberately extend his work.
His separate checkout must not be reset or edited by the next agent.

## Release execution

Release PR #224 is merged at 8837fd949582f60de0fef5a0fb575246a2ab630d.
Claude PRs #222 and #223 are also marked merged. GitHub v7.4.0 is public with
21 assets, each fetched anonymously and checked for SHA-256 and size.
Both clean-main Guilded quality jobs passed in run 40251771094, including
PostgreSQL migration/restore and Windows installer packaging.
Local full suite: 295 files / 2,548 tests passed; TypeScript, lint, addon/catalog
validation and both dependency audits passed (zero vulnerabilities).
The first local packaging run detected a checkout-transition mismatch; all
artifacts were rebuilt from clean main and passed source/ASAR verification.

Oracle and the online companion now run 7.4.0 / protocol 2 at that commit.
Systemd is active; public health is OK and Discord command registration is OK
in every server. Post-deploy ledger references remain unique. Database and
application backups were verified before deploy, then encrypted off-server
and verified by authenticated decryption/checksums. Private locations are in
backups/release-7.4.0/preflight-result.json and offsite-backup.json.

CurseForge submissions and the public website metadata update are in progress.
The existing local companion installation was not changed; the new installer
is published and available through the normal updater. Real-client checks
remain pending.
Never infer deployment or CurseForge approval from a successful build/upload.
Previous published release 7.3.2 must remain intact. Candidate artifacts named
LOCAL-REVIEW are historical and must not be distributed as the new release.

## Tomorrow: unfinished acceptance and decisions

1. Complete [7.4.0 game/client acceptance](V7_4_0_GAME_CHECKLIST.md), including all
   carried-forward 7.3.2 and two-PC checks, when game access is available.
2. Confirm Forever custom buff coverage and calibrate dungeon benchmarks using
   real observations. Current baselines are explicitly provisional.
3. Reconcile a real GRM archive; confirm local history privacy, restore and large
   import usability. Migration is history-only, not character ownership or EPGP.
4. Test live Discord multi-edition permissions and concurrent roster editing,
   plus Windows clean install/upgrade on a second PC.
5. Review remaining roadmap proposals separately. Main/alt review stays preview-only;
   no automated ownership changes were promised or silently enabled.
6. Complete any publication or approval items explicitly left pending below.

## Operational guardrails

Read CLAUDE.md first. Production is Aiven PostgreSQL and one Oracle bot instance.
Do not launch a second local bot. Deploy only clean main after both Guilded quality
jobs pass, a read-only ledger preflight and verified backup. Preserve pairing and
SavedVariables. Local ignored evidence lives under backups/release-7.4.0/.
