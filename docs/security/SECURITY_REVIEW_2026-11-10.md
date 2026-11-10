# Guilded security & abuse review (read-only) — 10 Nov 2026

Scope: `main` @ `8b073f5d` (Nov 10, 10:48 AM ET, #726). Read from a detached worktree (`/workspace/sec-main`), the local checkout was not touched.
Method: targeted code reading (no exhaustive line-by-line review), plus `npm audit` on the lockfiles, a secret-pattern scan of the tree and of main's history (1,696 commits), a workflow review, and a few plain GETs to public endpoints. No pushes, comments, issues, deploys, fuzzing or load. GitHub Dependabot, code-scanning and secret-scanning alerts were **not checked**: the connector has no alert tools and the box has no GitHub login.
Links: `https://github.com/kevincaron28/Guilded/blob/main/<path>#L<n>`

## Summary

| # | Sev | Finding | Owner |
|---|-----|---------|-------|
| 1 | **High** (likely, verify) | Bot rate limits and lockouts are keyed on the Worker's egress IP, so every user shares one bucket. Anyone can lock the whole companion API for everyone, and normal traffic hits global caps | Worker + bot |
| 2 | **High** | Season 1 publishes runs from anonymous device keys on the **public** leaderboards, for any guild name and any character names. They stay on the boards permanently. A "second witness" is also trivial to fake with two keys | Bot (Claude) |
| 3 | Medium | A single signed-in uploader can post a fabricated record time (only a 45 s/boss floor) | Bot (Claude) |
| 4 | Medium | No client-wide `allowedMentions` default: about 400 send/reply/edit calls rely on each call site to block role and user pings | Bot (Claude) |
| 5 | Medium | Self-role panels can hand out roles that carry **Guilded** authority (Officer, Raid Leader, DKP Officer, Class Leader (X)), because the check only looks at Discord permissions | Bot (Claude) |
| 6 | Low | Bot-rendered pages and the API have no HSTS. The static site's HSTS has no `includeSubDomains` | Website/worker |
| 7 | Low | Command errors under 200 characters are shown raw to users (possible internal detail leak). A deferred non-ephemeral reply shows them publicly | Bot (Claude) |
| 8 | Low | The stats-feed key is in the URL. Caddy's log filter removes credential headers but not the URI query | Bot/deploy |
| 9 | Low | Mobile: 8 moderate `npm audit` advisories (glob/minimatch through the expo toolchain, build-time only) | App (Claude) |
| 10 | Info | Things that checked out well (listed at the end) | — |

---

## 1. High (likely, needs one server-side confirmation): every visitor shares one IP for the bot's rate limits

**Where**
- [`src/companion-api.ts#L172-L185`](https://github.com/kevincaron28/Guilded/blob/main/src/companion-api.ts#L172-L185) `clientAddress()` trusts `X-Forwarded-For` from Caddy (loopback).
- [`deploy/Caddyfile#L38-L40`](https://github.com/kevincaron28/Guilded/blob/main/deploy/Caddyfile#L38-L40): plain `reverse_proxy`, so Caddy sets XFF to its direct peer.
- [`worker/index.mjs#L398-L413`](https://github.com/kevincaron28/Guilded/blob/main/worker/index.mjs#L398-L413): the Worker deliberately does **not** forward the visitor's IP to the bot. Its direct peer is therefore a Cloudflare Workers egress address, which is the same for everyone (often `2a06:98c0:3600::103`).
- Limits that become global:
  - [`#L154-L155`](https://github.com/kevincaron28/Guilded/blob/main/src/companion-api.ts#L154-L155) and [`#L739-L743`](https://github.com/kevincaron28/Guilded/blob/main/src/companion-api.ts#L739-L743): 10 failures in 10 minutes locks out **every** API route after line 739.
  - [`companion-device.ts#L29-L33`](https://github.com/kevincaron28/Guilded/blob/main/src/services/companion-device.ts#L27-L35): 5 device registrations per hour and 120 device uploads per hour.
  - `allowSignInStart`, `allowCompanionRevocation` and the device-claim limiter.

**What an abuser could do.** Send about 10 requests with a junk `x-companion-credential` or a wrong pairing code. That locks out sign-in, pairing, hub, standings, device uploads and the rest for **all users** for 10 minutes, and repeating it keeps them locked out. No abuse is even needed to hit trouble: once Guilded has more than a handful of zero-setup companions, the 5 registrations and 120 uploads per hour become caps for the whole user base. Expired codes and stale credentials from ordinary users also add up to the global lockout.

**Evidence.** Code path as above. The origin gate works: `bot.kcaron.top` and `guildedqc.duckdns.org` return 404 without the Worker token, so all traffic does come through the Worker. **Unverified:** I did not read the server logs. Confirm with the bot's own logged addresses, or with how often "Too many failed attempts" / "Too many new companions from this network" 429s appear in the journal. (I deliberately made only 1–2 failing requests, so I wouldn't add to a shared lockout.)

**Fix (worker + bot, small)**
1. Worker: `headers.set("x-guilded-client-ip", request.headers.get("cf-connecting-ip") ?? "")`. Exclude `x-guilded-client-ip` from the caller pass-through regex at L409 (like `x-guilded-origin`), so a caller can't set it.
2. Bot: in `clientAddress`, when the peer is loopback **and** `x-guilded-origin` matches the configured token (`timingSafeEqual`), use `x-guilded-client-ip`. Otherwise keep the current behaviour.
3. Defence in depth: only count a failure toward the lockout when the request carried a well-formed secret (right length and alphabet), and key credential failures by a credential-hash prefix as well as the IP.
4. Add a test: two different `cf-connecting-ip` values must not share a lockout.

## 2. High: anonymous device keys can put fabricated runs on the public leaderboards (Season 1)

**Where**
- [`src/services/run-trust.ts#L33`](https://github.com/kevincaron28/Guilded/blob/main/src/services/run-trust.ts#L33) `countsDeviceOnlyRuns`: true until a Season ≥ 2 starts.
- [`#L130`](https://github.com/kevincaron28/Guilded/blob/main/src/services/run-trust.ts#L130) `decide()`: with `allowDeviceOnly`, an unanchored single statement is stored as `trust:"device"`.
- [`#L109`](https://github.com/kevincaron28/Guilded/blob/main/src/services/run-trust.ts#L109) `independent()`: two statements only need different device keys and different voucher names.
- [`src/services/public-runs.ts#L419-L426`](https://github.com/kevincaron28/Guilded/blob/main/src/services/public-runs.ts#L419-L426): Season 1 device runs are published, and they stay published after Season 2 (`endedAt < season2Start`).
- [`companion-device.ts#L194`](https://github.com/kevincaron28/Guilded/blob/main/src/services/companion-device.ts#L194): the guild is matched by the **declared guild name**.
- Introduced or extended by #726 today. RUN_TRUST_2026-11-10.md itself says "any key can name any 12 characters and post runs for them".

**What an abuser could do.** With no Discord account at all:
- `POST /api/v1/device/register` (5 per hour per IP, and see #1: really 5 per hour per Worker IP).
- Upload saved-variables JSON naming guild "Quebec Gold" and any 12 characters, including real members' names. Each key can store 20 device-trust runs a day, and they're published on the public boards with fast times and arbitrary parties.
- With 2 keys naming different characters, runs become `witnessed`. That path is uncapped and survives Season 2, so the "strict from Season 2" promise is weak against even this small Sybil attack.

The effect is leaderboard inflation and records falsely attributed to real players. The device's own 20/day cap does nothing, because keys are free.

**Evidence.** Code above, and the commit message of #726. Not exercised live.

**Fix (bot, Claude)**
- Minimum: during Season 1, store device-only runs but **don't publish** them on public boards. Keep them on the guild's own board and badge them "unverified". Alternatively publish only when `anchored` (a party member is on the officer-synced roster or has a linked character).
- Don't let unclaimed devices count as independent witnesses. A witness should need a claimed device (a Discord member), or devices registered from different client IPs (needs #1) and more than X hours old.
- Never let device-only runs set a record (rank 1 or top N): require member trust for those.
- Add a backfill flag so Season 1 device runs can be hidden later without a migration.
- Owner decision needed: this reverses part of today's "Season 1 counts device-only" call, so ask Kevin.

## 3. Medium: a signed-in uploader can post a fabricated record time

**Where.** [`src/services/public-runs.ts#L31`](https://github.com/kevincaron28/Guilded/blob/main/src/services/public-runs.ts#L31) `PUBLIC_LIMITS` (`minSecondsPerBoss: 45`). Edited saved files are accepted as long as the run's internal fields agree.

**What an abuser could do.** Edit their own saved file to show a clear barely above the floor and take #1. It's accountable (tied to a Discord account), but it's visible right away.

**Fix.** Per-dungeon minimum clear times (a percentile of real clears), not a flat per-boss floor. A new record that beats #2 by more than X% goes pending until a second party member's upload corroborates it, or an officer or the owner reviews it. "Report this run" should feed the existing review path.

## 4. Medium: no global `allowedMentions` default on the Discord client

**Where.** [`src/main.ts#L161-L168`](https://github.com/kevincaron28/Guilded/blob/main/src/main.ts#L161-L168): `new Client({...})` has no `allowedMentions`. 245 call sites set it, and roughly 400 send/reply/edit calls don't. One example of interpolated text with no guard is `src/commands/poll.ts#L163`, with the poll question and options. **Unverified:** I did not trace every call site that takes user input.

**What an abuser could do.** Any user-supplied string that reaches `content` can ping roles that have "allow anyone to mention" turned on, or mass-ping users with `<@id>` lists. `@everyone`/`@here` only work if the server gave the bot Mention Everyone or Administrator. The public invite (`permissions=2269718837849168`) doesn't include it, but some servers grant Administrator.

**Fix.** One line: `allowedMentions: { parse: ["users"], repliedUser: false }`, or `{ parse: [] }`, on the Client. Call sites that really need a role ping (raid call-outs) opt in with explicit `roles: [id]`. Add a test that the Client options include it.

## 5. Medium: self-roles can grant Guilded officer authority

**Where.** [`src/services/selfrole.ts#L19-L26`](https://github.com/kevincaron28/Guilded/blob/main/src/services/selfrole.ts#L19-L26) checks only Discord permission bits. Guilded authority, though, comes from role **names** ("Officer", "Raid Leader", "DKP Officer", "Class Leader (…)" in EN/FR), or from scoped role IDs: see [`src/permissions.ts#L45-L75`](https://github.com/kevincaron28/Guilded/blob/main/src/permissions.ts#L45-L75).

**What an abuser could do.** If an officer adds, say, "Class Leader (Warrior)" or a "Raid Leader" role with no Discord permissions to a self-role panel or onboarding, anyone can take it and use EP/GP, loot or raid officer tools. Exploiting it takes a configuration mistake, but the panel is meant to stop exactly that kind of mistake.

**Fix.** In `selfRoleProblem`, also reject any role where `isPermissionRole(p, role)` is true for any `Permission`, or that matches a scoped `permissionRoles` ID. This covers `housekeeping.ts#L206` and `onboarding.ts#L132` too, since they share the helper. Add a test.

## 6. Low: HSTS gaps
- The static site sends `strict-transport-security: max-age=31536000`, with no `includeSubDomains` or `preload`.
- Bot-rendered pages (`/forever/leaderboards/`, `/g/...`) and `/health`/API responses send no HSTS header. Their CSP and nosniff are good.

**Fix (website/worker).** In the Worker's final response wrapper (`fetch` in `worker/index.mjs#L268-L283`), set HSTS on every response, and `x-frame-options: DENY` on bot pages too (CSP `frame-ancestors 'none'` already covers modern browsers). Add `includeSubDomains` only after confirming every `*.kcaron.top` host is HTTPS-only (dl, bot and www are).

## 7. Low: raw error messages reach users
[`src/commands/context.ts#L63-L72`](https://github.com/kevincaron28/Guilded/blob/main/src/commands/context.ts#L63-L72): any `Error` with a message under 200 characters is shown verbatim. That could be a Prisma, network or Discord error such as `connect ECONNREFUSED 10.x:5432`. When the interaction was deferred as non-ephemeral, `editReply` posts it publicly.
**Fix.** Show the message only when `isMemberAnswer(error)` is true (deliberate user-facing errors), and otherwise use the generic text plus the error-report ID.

## 8. Low: stats-feed key in the URL
`/api/v1/stats-feed?guild=…&key=…` needs the key in the URL for Google Sheets IMPORTDATA. The key is hashed and compared in constant time ([`stat-snapshots.ts#L120-L126`](https://github.com/kevincaron28/Guilded/blob/main/src/services/stat-snapshots.ts#L120-L126)), which is good. But the [Caddy log filter](https://github.com/kevincaron28/Guilded/blob/main/deploy/Caddyfile#L14-L22) drops credential headers and not `request>uri`, so error entries in the journal can contain the key.
**Fix.** Add a `request>uri query { replace key REDACTED }` filter in the Caddy log block. Let officers rotate the key from `/settings` (check whether that already exists).

## 9. Low: dependencies
- `npm audit --omit=dev`: root and companion-app are clean. `mobile` has 8 moderate advisories (glob 9–14 / minimatch 7–11 through `@expo/cli`, `@expo/fingerprint` and `@expo/metro-config`). They're build-time only, and an Expo SDK bump fixes them.
- Dependabot is configured. GitHub's own Dependabot, code-scanning and secret-scanning alert lists are **unchecked**: no API access.

## 10. Checked and fine
- **Worker:**
  - Origin token is set only by the Worker, and caller `x-guilded-origin` is ignored.
  - Origin hosts return 404 without the token (verified with GET).
  - Fixed-origin URL building (no SSRF), with redirect allow-listing.
  - Set-cookie allow-list (`__Host-` and HttpOnly only).
  - 1 MB body cap, and Cloudflare rate limits keyed on `cf-connecting-ip`.
  - Dev CORS only for `localhost`/`127.0.0.1`, with no credentials.
  - `/owner` uses a properly verified Cloudflare Access JWT (RS256, iss/aud/email/exp/nbf), canonical host only.
  - Static-site CSP is strict (hash-pinned script).
- **Bot API:**
  - Credentials are 32 random bytes, stored as SHA-256 hashes.
  - Pairing codes are 48-bit with a 15-minute lifetime and single use. Verify codes are 8 letters (~36 bits).
  - gzip is bounded (`maxOutputLength` 8 MB).
  - Web POSTs check Origin plus a session CSRF token.
  - The hub, standings and similar routes return 400/401 with no data when called unauthenticated.
  - `/health` exposes only the version and feature flags.
- **SQL:** no `$queryRawUnsafe`/`$executeRawUnsafe` anywhere, and only tagged-template `$executeRaw`.
- **Secrets:**
  - No live tokens or keys in the current tree. The history hits are only placeholders (`DISCORD_TOKEN=placeholder`, `your-private-bot-token`) and a test PEM stub.
  - No `.env`, keystore or pfx files committed.
- **GitHub Actions:**
  - Triggers are `push`, `pull_request`, `schedule` and `workflow_dispatch`, with no `pull_request_target`/`workflow_run`.
  - `permissions: contents: read`.
  - Only first-party `actions/*` (tag-pinned; SHA-pinning is optional hardening).
  - The only secret is `UPTIME_DISCORD_WEBHOOK`, on a schedule-only workflow.
- **Companion (Windows):**
  - Config is encrypted with Electron `safeStorage` (DPAPI).
  - `contextIsolation`, `sandbox`, no `nodeIntegration`, navigation blocked.
  - The window-open handler sends http(s) links to the external browser only.
  - The sign-in loopback listens on 127.0.0.1 only.
- **Mobile:** credentials are in `expo-secure-store` (Keychain/Keystore).
- **Addon comms:** messages pass through `ns.comm.accept` with a guild-member sender check, and the bot treats all addon data as untrusted. Not reviewed in depth.

## Not covered (would need more time or access)
- Full trace of every officer command's permission check (59 files use `hasPermission`; sampled only).
- EP/GP ledger import authorization end to end. It looks gated by officer credentials but wasn't fully traced.
- Card game (Clash/trade) race conditions such as double-spend on trade confirm or pack opening.
- GitHub security alert lists, the server-side Caddy origin snippet, and Cloudflare dashboard settings (WAF, bot fight mode).

---

## Brief for Claude Code (paste as-is)

> Security fixes from Grok Bot's read-only review of main@8b073f5d (full report: security-review-2026-11-10.md). One PR per item; each needs a test. Don't change behaviour beyond what's listed.
>
> 1. **Real client IP for bot rate limits (High, pairs with a Worker change Grok Bot handles).** `src/companion-api.ts` `clientAddress()`: when the peer is loopback AND header `x-guilded-origin` equals the configured origin token (`timingSafeEqual`), use header `x-guilded-client-ip`; otherwise keep the current logic. Only call `recordFailure` when a secret/code was present and well-formed. Test: two different client IPs don't share `isLockedOut`, `deviceRegistrations` or `deviceUploadsPerIp`. Ship the bot side first (it falls back safely), then the Worker sets the header.
> 2. **Device-only runs off the public boards (High; Kevin approved on Nov 10, 2026, even though it reverses part of #726).** `src/services/public-runs.ts`: exclude `trust: "device"` and `trust: "witnessed"` from public leaderboards in every season (keep them on the guild board, badged unverified), unless the run is `anchored`. `src/services/run-trust.ts` `independent()`: a witness counts only if at least one of the two devices is claimed by a member, or the devices differ in registration IP (after item 1) and are more than 24 h old. Device-only runs can never hold rank 1 or top-3.
> 3. **Record plausibility (Medium).** `public-runs.ts`: per-instance minimum clear time (start from the observed 5th percentile, fall back to 45 s/boss). A run that beats the current #1 by more than 10% stays pending until a second party member's upload or an officer review.
> 4. **Global mention safety (Medium).** `src/main.ts` `new Client({... allowedMentions: { parse: ["users"], repliedUser: false } })`; call sites that need a role ping pass explicit `roles: [id]`. Grep for sends that ping roles (raid call-outs, signups) and opt them in. Test that the Client option is set.
> 5. **Self-roles can't grant Guilded authority (Medium).** `src/services/selfrole.ts` `selfRoleProblem`: also return a problem if `isPermissionRole(p, role)` is true for any `Permission` key (EN/FR names, Class Leader variants, scoped role IDs). Test with "Raid Leader" and "Chef de classe (Guerrier)" roles that have no Discord permissions.
> 6. **Don't show raw errors (Low).** `src/commands/context.ts#L63`: use `error.message` only when `isMemberAnswer(error)`; otherwise use the generic text.
> 7. **Mobile deps (Low).** Bump the Expo SDK and toolchain in `mobile/` to clear the glob/minimatch advisories (`npm audit` in `mobile`).
> 8. **Caddy log redaction (Low).** `deploy/Caddyfile` log filter: also redact `request>uri` query `key`.

## Website / worker fixes (Grok Bot's side, with Claude Code)
- **W1 (with #1):** in `worker/index.mjs` `route()`, set `x-guilded-client-ip` from `cf-connecting-ip` for api and web requests, and exclude that name from the caller pass-through regex (L409). Add a test in `tests/worker-routing.test.ts` that a caller-supplied `x-guilded-client-ip` is overwritten.
- **W2:** add HSTS to every Worker response (bot-rendered pages, API, redirects) in the `fetch` wrapper. Consider `includeSubDomains` once all subdomains are confirmed HTTPS-only.
- **W3 (optional):** `x-frame-options: DENY` and `permissions-policy` on bot-rendered pages, to match the static site.
- **W4 (optional):** SHA-pin `actions/*` in `.github/workflows/*.yml`.
- Deploy only with Kevin's OK, after a backup, through the normal push-to-main → Workers Builds path.
