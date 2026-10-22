# Guilded System Review — October 16, 2026

**Scope:** Comprehensive review of Guilded v6.2.0 across all four components —
Discord bot, WoW addon, companion, and website/worker. Focus: sync reliability,
architectural risks, and prioritized improvements to make this a top-tier guild system.

**Reviewed by:** Claude (Cowork session, read-only analysis).
**Sources:** CLAUDE.md across all branches, source files in `Quebec Gold Bot/` (6.2.0),
`SYNC_SPEEDUPS_2026-10-15.md`, `V6_2_RELEASE_NOTES.md`, `V6_2_GAME_ACCEPTANCE.md`,
`V6_2_STANDALONE_AND_GAMES.md`, `worker/index.mjs`, `companion/engine.mjs`,
`companion/delta.mjs`, `src/services/standings-feed.ts`, `addon/Guilded/Core.lua`,
`addon/Guilded/Util.lua`.

---

## Follow-up: implemented the same day (not deployed)

| Item | Change | Files |
|---|---|---|
| R3 stamp persistence | Shared stamps saved to `backups/standings-stamps.json` (debounced, atomic, flushed on shutdown) and restored before the companion API starts. Unchanged data keeps its stamp and ETag after a restart, so companions get `304` and in-game clients do not rebroadcast. No database migration. | `src/services/standings-feed.ts`, `src/main.ts` |
| R4 Worker headers | `x-guilded-*` / `x-companion-*` headers pass through (≤ 512 bytes). Proxy/address headers stay blocked. | `worker/index.mjs` |
| R5 long-poll margin | Companion long poll 15 s → 12 s. | `companion/engine.mjs` |
| R6 file watch | A watch that gave up is retried every 5 minutes; failures more than 10 minutes apart no longer add up to "keeps stopping". New `fileWatch` state (`watching` / `checking`). | `companion/engine.mjs` |
| R9 command size | Test now fails 100 characters before Discord's limit and names the command. Largest today: `/character` ≈ 3,740 (not `/setup`/`/config`, ≈ 2,720). | `tests/commands-shape.test.ts` |
| New: owner welcome | Approving a server from the pilot DM sends that server's owner a bilingual welcome DM with next steps. A closed DM never undoes approval; your confirmation says whether it was delivered. | `src/services/pilot-welcome.ts`, `src/services/pilot-requests.ts`, `src/main.ts` |

**Correction to R2:** `deploy/guilded.service` already has `Restart=always`, and `main.ts` exits
on uncaught exceptions so systemd restarts it. Only external monitoring (an uptime check on
`/health`) is still missing.

Verification (Linux sandbox): `tsc`, ESLint and the addon validator pass; all 191 Vitest files pass.
The sandbox lacks Prisma's Linux engine, which only produces background "query engine" notices.
Deployment order: bot, then Worker (optional), then companion builds. No version bump.

---

## 1. Architecture Map

```
WoW Game Client
  └── Guilded addon (Lua)
        ├── SavedVariables: Guilded.lua  ─────────────────────┐
        ├── In-game broadcast (GUILD/RAID/PARTY prefix msgs)   │
        └── GuildedData addon (recovery, written by companion) │
                                                               │ file watch
Companion (Electron / Node CLI)  ◄─────── writes Standings.lua │
  ├── Reads Guilded.lua (watches folder + 30s check)  ─────────┘
  ├── Prunes acknowledged entries (delta.mjs)
  ├── Gzip compresses payload
  └── HTTP  ──────────────────►  Cloudflare Worker (worker/index.mjs)
                                    │  forwards selected headers
                                    │  20 s timeout
                                    ▼
                               Discord Bot (Oracle Cloud VM)
                                 ├── REST API (Express/fastify)
                                 ├── Aiven PostgreSQL
                                 ├── StandingsFeed (in-memory cache + long-poll)
                                 └── Discord gateway (slash commands, events)
```

**Data flows:**

| Direction | Mechanism | Latency |
|---|---|---|
| In-game award → Bot | File save → companion watch → POST upload → standings refresh | Seconds (live-poll) |
| Bot standings → Addon | Long-poll GET + companion writes Standings.lua | Seconds (live) / up to 2 min (interval fallback) |
| Officer A → Officer B (in-game) | `Guilded` prefix addon message, v2 wire format | Near-instant (throttle permitting) |
| Officer ledger sync (standalone) | LedgerSync.lua: SUM→AUTH→DAYS→GET→E protocol | Minutes (when both officers online) |

---

## 2. What Works Well

**Sync architecture (6.2.0) is genuinely clever:**

- **ETag / long-poll combo** means a Discord award reaches the addon in seconds, not minutes. The shared-stamp design (keyed on shared content hash, not request time) eliminates the old re-broadcast storm when two officers had companions running.
- **Delta uploads** (acked ledger/loot refs pruned before sending) keep payload size small indefinitely regardless of ledger history.
- **Gzip + fallback** drops upload size several times over, with an automatic plain-text fallback if any proxy rejects the encoding.
- **Companion resilience**: folder-watch self-restart (up to 5 times), 30-second file-check safety net, abortable sleep so stop() is clean, generation counter to discard stale callbacks, `queued` flag to avoid losing a save that arrives during an in-flight upload.
- **LedgerSync deduplication**: permanent entry IDs with a "void wins" merge rule means multi-officer ledger exchange has no conflict resolution to fail on.
- **Backward compatibility** is handled at every layer (CAP/REQ/DATA v1+v2, no-feature companion path, worker-agnostic header handling). An old companion or old addon never silently loses data.

**Addon quality:**

- `ns.comm` paced queue with burst+rate limiting and retry on throttle means officers never silently drop a message during combat.
- `util.tooFarAhead()` refuses future-dated stamps, preventing a rogue or clock-skewed client from pinning shared data forever.
- `logDiagnostic` with deduplication and pre-login buffering means errors survive the frame-load timing window and are inspectable via `/guilded diag`.
- The `effectiveStanding()` overlay (local pending + peer ledger entries on top of server baseline) means two officers handing out loot in the same raid see each other's GP charges immediately.

**Test coverage is solid:** 176 files / 1,459 Vitest tests + Lua harness (fengari), ESLint, tsc, addon validator. Known gaps are documented, not hidden.

---

## 3. Reliability Risks — Prioritized

### 🔴 Critical (affects live users today)

**R1 — 6.2.0 released without any in-game acceptance test (G1–G12 all Pending)**

Every item in `V6_2_GAME_ACCEPTANCE.md` is unverified in a real WoW client. The offline test suite cannot catch:
- `GuildedData` loading order on the actual client
- The floating-boss-timer removal not breaking Deadmines encounter detection
- Long-poll timing through the live Cloudflare Worker
- Two-PC officer bridge with mixed addon versions (the known proactive-share gap, G12)
- Standalone accounting (G3–G5) and restore/undo (G4)

**Action:** Run G1, G2, and the companion desktop check first — these are the quickest passes and block everything else. G6 (Deadmines) and the companion sync latency check are second.

---

**R2 — Single point of failure: Oracle Cloud VM + DuckDNS**

The entire system routes through one process on one VM at `guildedqc.duckdns.org`. If the VM crashes, is rebooted, or DuckDNS fails to update after an IP change:
- All companion uploads fail with a generic "temporarily unavailable" 502
- Long-poll companions loop on error with exponential backoff (capped at 5 min), which is good — but users see a broken companion for the whole duration
- No health-check alert, no auto-restart, no failover

**Action (short term):** Add a systemd service with `Restart=on-failure` and a simple external uptime check (UptimeRobot or similar, pinging `/health`). The worker already proxies `/health` — wire an alert to it.

**Action (longer term):** If the guild grows, consider moving the bot to a managed Node.js host (Railway, Render, Fly.io) with automatic restarts and zero-downtime deploys, removing the manual Oracle SSH deploy step.

---

**R3 — Shared stamp lives only in bot memory**

`standingsFeed`'s `stamps` map is in-process. On every bot restart, the stamp is reset. The first standings answer after a restart has a new stamp, so every in-game client that was online at restart time rebroadcasts the full standing set over the in-game officer bridge — potentially minutes of addon message traffic for a large guild.

For a single-guild bot this is minor. For a multi-guild bot it's proportional to the number of active guilds × connected officers. With the current single guild it's one rebroadcast event every bot restart, which is acceptable but worth documenting.

**Action:** Persist the stamp map to a small DB table (one row per guild: `guild_id, hash, at`). A restarted bot restores the last stamp and companions get a 304 instead of a full answer.

---

### 🟡 Medium (affect reliability or maintainability)

**R4 — Cloudflare Worker header allowlist requires redeploy for new bot features**

`worker/index.mjs` hardcodes the forwarded headers:
```js
["content-type", "content-encoding", "x-companion-credential", "authorization", "accept", "if-none-match"]
```

Any new header the bot needs (e.g., a future `x-protocol-version` or `x-guild-timezone`) is silently dropped until the Worker is redeployed. The bot must code around this every time. The `since` parameter fallback for ETag is already a workaround for this.

**Action:** The cleanest fix is to forward all `x-*` headers generically, or move to a wildcard allowlist for non-sensitive headers. Keep blocking `cookie`, `set-cookie`, `authorization` on responses. This removes the coupling between bot changes and Worker redeploys.

---

**R5 — Long-poll 15 s / Worker 20 s margin is tight on degraded networks**

The companion uses `LONG_POLL_SECONDS = 15` and the Worker times out at 20 s. The gap is only 5 seconds of network/proxy overhead budget. On a slow connection or during an Oracle peak, the Worker may cancel the request and return a 502 before the bot responds with a 304. The companion then logs "temporarily unavailable" for a single missed poll — not a data loss, but a misleading error.

**Action:** Reduce `LONG_POLL_SECONDS` to 12 s (3 s more buffer), or increase the Worker timeout to 25 s (free on Cloudflare Workers). Either is a one-line change.

---

**R6 — `watchRestarts` cap of 5 degrades to 30-second polling permanently**

After 5 consecutive watcher errors, the companion logs "File watch keeps stopping" and stops trying to restart, relying entirely on the 30-second timer. A transient Windows issue (antivirus scan, backup software) that causes 5 quick failures will permanently degrade a user to 30-second upload latency for the rest of the session — without a clear user-visible indicator in the tray UI beyond a log line they may not see.

**Action:** Reset `watchRestarts` to 0 after a period of successful uploads, so a recovered system re-enables fast watching. Or surface "upload mode: slow (file watch unavailable)" more prominently in the tray/app UI.

---

**R7 — Raids are never delta-pruned from uploads**

`delta.mjs` only prunes ledger and loot entries. Raids (the `db.raids` array) are sent in full on every upload because the bot has no acknowledgement mechanism for them (no stored reference to compare against). The comment in `SYNC_SPEEDUPS_2026-10-15.md` notes this is intentional for now.

For an active guild recording every raid session over months, `db.raids` will keep growing. Once it becomes a meaningful fraction of the 1 MB upload limit, officers start seeing "This upload is N KB" errors.

**Action:** The bot can begin storing the last-seen raid array hash (like it does for ledger refs) and emit `acceptedRaidRefs`. Alternatively, the companion could prune raids older than X months from the upload payload (they're already in the DB). Low urgency now; add to the v6.3 candidate list.

---

**R8 — LedgerSync "offline officer misses merges" gap**

From the docs: "An officer who is offline catches up the next time two officers with sync on are online together." In a guild where only one officer is typically online at a time (common in small guilds), sync never triggers. The record keeper's PC holds the canonical ledger; other officers' entries live only on their own PCs until a moment of overlap.

This is documented behavior, not a bug. But in practice, a guild that turns on `/guilded ledgersync on` expecting automatic sync may be surprised when the other officer's entries never appear.

**Action:** Add a `/guilded ledgersync status` output that says "Last sync with [officer]: [time]" or "No sync partner has been seen recently" to set expectations. The groundwork is already in `LedgerSync.lua`'s `status` command — just surface the last-sync timestamp per known partner.

---

**R9 — The `/setup`+`/config` merged command sits near Discord's 4,000-character limit**

This is a known fragile spot (per CLAUDE.md): only `tests/commands-shape.test.ts` catches an overflow, not TypeScript. Any future addition to `setup.ts` or `settings.ts` — a new setting name, a longer description, a new choice — can silently push it over the limit, causing the bot's command registration to fail on the next deploy.

**Action:** Add a size margin threshold to the test (e.g., fail if within 200 characters of the limit, not just over it), so you have visible runway before hitting the wall. Also document in `setup.ts`'s file header that descriptions must be kept short.

---

### 🟢 Low / polish

**R10 — `gzipOff` flag is session-scoped only**

If a proxy rejects gzip (400/415 response), the companion falls back to plain for the rest of that session. On the next start it tries gzip again, which might fail again. For a user behind a corporate proxy that always rejects gzip, this causes one failed upload per companion start.

**Action:** Persist `gzipOff = true` to the companion's state/config file if it triggers, so repeat starts don't retry a known-failing encoding.

---

**R11 — Version bump has a live side effect (version-announce.ts)**

Any incidental `package.json` version bump triggers "Guilded was updated to vX.Y.Z" in every guild's bot-guide channel. This is well-documented in CLAUDE.md, but it's a footgun: a dependency update PR that bumps the patch version fires an announcement. The check is runtime-only (no build-time lint rule).

**Action:** Add an ESLint rule or pre-commit hook that warns when `package.json`'s `version` field changes without a corresponding entry in a changelog or release notes file. Low-cost enforcement.

---

**R12 — French translation coverage gap**

The i18n enforcement only runs on a specific list of files (`SOURCES` in `scripts/i18n-keys.mjs`). New files or new user-facing strings in unlisted files go to French users untranslated, silently. There's no "untranslated strings found" check for files outside the list.

**Action:** Add a comment in `src/i18n-fr.ts` (or a short doc) listing which files are NOT in scope and why, so a future contributor knows the gap is intentional rather than an oversight.

---

## 4. Sync Mechanism Summary

### Upload path (addon → bot)

```
Officer awards EP → Guilded.lua updated on logout/reload
Companion watches folder (inotify + 30s fallback)
  → readAddonExport() parses Lua
  → pruneAcknowledged() removes acked refs
  → jsonBody() gzip-compresses
  → POST /api/v1/addon-imports (credential + gzip headers)
  → Bot applies, returns { acceptedLedgerRefs, acceptedLootRefs, features }
  → Companion stores ack + features, triggers standings refresh
  → markGuildChanged() wakes any waiting companions
```

**Weak points:** WoW only writes SavedVariables on logout/reload, not continuously. A crash between award and logout loses the entry from the companion's view (it's still in memory but gone from disk). This is an inherent WoW limitation, not a Guilded bug. The `/guilded export` command forces an export marker; users should be reminded to reload after important award sessions.

### Download path (bot → addon)

```
Companion GET /api/v1/standings?guild=<id>&since=<etag>
  → StandingsFeed checks cache (ETag match → 304, no write)
  → Or rebuilds (10 queries + Discord call) and stamps with shared hash
  → Long poll: holds request up to 15s if nothing changed
  → Companion writes Standings.lua (skips if file unchanged)
  → Also writes GuildedData companion addon (recovery layer)
  → Addon reads on next /reload or from GuildedData
```

**Weak points:** The addon must be reloaded (`/reload` or relog) to pick up new standings. In-session standings are only updated via the in-game officer bridge. A player who doesn't reload before a loot decision sees stale standings. The GuildedData companion addon partially addresses this between sessions but not within one.

### In-game bridge (officer → officer)

```
Officer A logs in → sends CAP|2 + REQ|1
Officer B (online, newer) → waits 1-5s jitter → sends DATA|2
Other officers hearing B's DATA stay quiet (60s cooldown)
Awards in combat: LEDGER|<id>|<name>|<ep>|<gp>|<core> via RAID/PARTY
```

**Weak points:** The documented gap (G12): an older client already online before the officer logs in gets the officer's next *proactive* share only if the officer has seen evidence of older clients. It catches up at its next login. For a live raid this could mean one player has stale standings for up to ~10 minutes.

---

## 5. Top-10 Prioritized Recommendations

| # | Area | Action | Effort | Impact |
|---|---|---|---|---|
| 1 | **Acceptance testing** | Run G1–G2 + companion desktop check immediately; schedule G3–G7 before the guild's next raid | Low (time, no code) | 🔴 Critical — 6.2.0 has zero in-game validation |
| 2 | **Bot uptime** | Add systemd `Restart=on-failure` + UptimeRobot `/health` alert | 1–2 hours | 🔴 Critical — no auto-recovery today |
| 3 | **Stamp persistence** | Persist `standingsFeed` stamps to DB so restarts don't trigger mass rebroadcast | ~4 hours | 🟡 Medium — 1 DB row per guild |
| 4 | **Long-poll margin** | Lower `LONG_POLL_SECONDS` to 12 or raise Worker timeout to 25 s | 10 minutes | 🟡 Medium — prevents misleading 502 errors |
| 5 | **Worker header forwarding** | Forward all `x-*` headers (block only `cookie`/`set-cookie` on responses) | 30 minutes | 🟡 Medium — decouples bot and worker releases |
| 6 | **watchRestarts reset** | Reset counter after N successful uploads; surface "slow mode" in companion UI | 2 hours | 🟡 Medium — silent degradation today |
| 7 | **Command size margin** | Fail `commands-shape.test.ts` at 3,800 chars (200-char warning zone before 4,000) | 30 minutes | 🟡 Medium — earlier warning before deploy failures |
| 8 | **Raid delta** | Add `acceptedRaidRefs` to bot's standings answer; companion prunes old raids from upload | 4–6 hours | 🟢 Low now, 🟡 Medium as guild ages |
| 9 | **LedgerSync status** | Surface last-sync-partner + timestamp in `/guilded ledgersync status` | 2 hours (Lua) | 🟢 Low — UX clarity for standalone guilds |
| 10 | **gzipOff persistence** | Save `gzipOff` flag to companion config so known-failing encoding isn't retried on restart | 1 hour | 🟢 Low — minor unnecessary upload failures |

---

## 6. Architecture Assessment

**Verdict: Very strong foundation with one critical gap (acceptance testing).**

The 6.1→6.2 sync overhaul was well-executed: the ETag/long-poll/delta combination solves the original "full rebuild every 2 minutes" problem cleanly, with graceful degradation at every layer. The backward-compatibility design (feature negotiation, dual wire formats) means updates can be staggered without breaking users.

The main structural risk is the Oracle + DuckDNS single point of failure. It works well when it works, but there's no monitoring or automatic recovery — a bot crash is invisible until an officer notices the companion erroring. Adding systemd restart and a health-check ping (two trivial changes) closes most of that gap.

The standalone guild path (6.2.0's headline feature) is well-designed: it defaults to in-game-only, the LedgerSync protocol is safe (union merge, no conflicts possible), and the backup/restore handover path is explicit about its limitations. The main risk there is that it was shipped before any of the acceptance tests were run — that's the urgent action item.

**For a top-tier system:** The three changes that would make the biggest day-to-day difference are (a) systemd auto-restart with a health alert, (b) stamp persistence across restarts, and (c) closing out the 6.2 acceptance checklist. Everything else is incremental polish on an already solid design.

---

*Review completed October 16, 2026. No code was changed. All findings are based on static analysis of the source files as they exist in `C:\Users\Kev\Desktop\Quebec Gold Bot`.*
