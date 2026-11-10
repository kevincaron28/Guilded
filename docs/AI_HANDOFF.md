# AI handoff: ideas → research → ready for Claude

One shared document between Kevin (owner), Grok Bot (research, analysis, design, website/worker, marketing, security, testing) and Claude Code (main coder for the addon, companion apps, mobile app and bot).

**How it works**
1. Kevin drops an idea in **Inbox** (one line is enough).
2. Grok Bot researches and analyses it, then moves it to **Researched** with a recommendation (value, effort, risks, open questions).
3. Once Kevin approves, Grok Bot writes it up in **Ready for Claude** with a spec and acceptance checks. Claude works only from this section.
4. Claude moves the item to **In progress** with the PR link, then to **Done** with the PR and the release it shipped in.

**Rules**
- Claude: pick items from **Ready for Claude**, top first. One PR per item, each with a test. Don't change behaviour beyond the spec. If a spec is unclear, write the question under the item and skip it until it's answered.
- Website/worker items marked `Owner: Grok Bot` are done by Grok Bot, not Claude.
- Nothing merges, deploys or publishes without Kevin's OK. Deploy only after a backup.
- Keep each item short. Detailed design notes go in `docs/` and get linked from the item.
- `ROADMAP.md` stays the release and status record. This file is the work queue.

---

## Inbox (Kevin's raw ideas)

_Empty. Add one line per idea: date, idea._

## Researched (waiting for Kevin's decision)

_Empty._

## Ready for Claude

Priority order. Source: Grok Bot's read-only security review of main@8b073f5d, 10 Nov 2026 (`docs/security/SECURITY_REVIEW_2026-11-10.md` once added; summary below).

### S1. Real client IP for bot rate limits (High)
- **Problem:** the bot reads the client IP from Caddy's `X-Forwarded-For`, but every request arrives through the Cloudflare Worker, so all users share one IP. About 10 bad credentials lock the whole companion API for everyone for 10 minutes (`src/companion-api.ts` around L154 and L739), and the device registration and upload limits (`companion-device.ts` L27-35) become global caps.
- **Spec:** `src/companion-api.ts` `clientAddress()`: when the peer is loopback AND header `x-guilded-origin` equals the configured origin token (`timingSafeEqual`), use header `x-guilded-client-ip`; otherwise keep the current logic. Only call `recordFailure` when a secret or code was present and well-formed.
- **Acceptance:** a test shows two different client IPs don't share `isLockedOut`, `deviceRegistrations` or `deviceUploadsPerIp`.
- **Order:** ship this bot side first (it falls back safely). Then W1 below (Grok Bot) makes the Worker set the header.

### S2. Device-only runs off the public boards (High, Kevin approved 10 Nov 2026; partly reverses #726)
- **Problem:** with no Discord account, anyone can register a device key, claim any guild name (matched only by declared name, `companion-device.ts` L194) and post fake runs to the public Season 1 boards. Two keys make a run "witnessed".
- **Spec:** `src/services/public-runs.ts`: exclude `trust: "device"` and `trust: "witnessed"` from public leaderboards in every season (keep them on the guild board, badged unverified) unless the run is `anchored`. `src/services/run-trust.ts` `independent()`: a witness counts only if at least one of the two devices is claimed by a member, or the devices differ in registration IP (after S1) and are more than 24 h old. Device-only runs can never hold rank 1 or the top 3.
- **Acceptance:** tests for each rule above.

### S3. Record plausibility (Medium)
- **Spec:** `public-runs.ts`: per-instance minimum clear time (start from the observed 5th percentile, fall back to 45 s per boss). A run that beats the current #1 by more than 10% stays pending until a second party member uploads it or an officer reviews it.

### S4. Global mention safety (Medium)
- **Spec:** `src/main.ts`: `new Client({ ..., allowedMentions: { parse: ["users"], repliedUser: false } })`. Call sites that need a role ping pass explicit `roles: [id]`; grep raid call-outs and signups and opt them in.
- **Acceptance:** a test that the Client option is set.

### S5. Self-roles can't grant Guilded authority (Medium)
- **Spec:** `src/services/selfrole.ts` `selfRoleProblem`: also return a problem if `isPermissionRole(p, role)` is true for any `Permission` key (EN/FR names, Class Leader variants, scoped role IDs).
- **Acceptance:** tests with "Raid Leader" and "Chef de classe (Guerrier)" roles that have no Discord permissions.

### S6. Don't show raw errors (Low)
- **Spec:** `src/commands/context.ts` L63: use `error.message` only when `isMemberAnswer(error)`; otherwise show the generic text.

### S7. Mobile dependencies (Low)
- **Spec:** bump the Expo SDK and toolchain in `mobile/` to clear the glob/minimatch advisories (`npm audit` in `mobile/`).

### S8. Caddy log redaction (Low)
- **Spec:** `deploy/Caddyfile` log filter: also redact the `key` query parameter in `request>uri`.

### Website / Worker (Owner: Grok Bot)
- **W1 (after S1 is live):** `worker/index.mjs` `route()`: set `x-guilded-client-ip` from `cf-connecting-ip` for API and web requests, and drop that header from caller pass-through. Test in `tests/worker-routing.test.ts` that a caller-supplied value is overwritten.
- **W2:** HSTS on every Worker response (bot pages, API, redirects).
- **W3 (optional):** `x-frame-options: DENY` and `permissions-policy` on bot-rendered pages.
- **W4 (optional):** SHA-pin `actions/*` in `.github/workflows/*.yml`.

## In progress

_Empty. Format: item id, PR link, who._

## Done

_Empty. Format: item id, PR link, release._
