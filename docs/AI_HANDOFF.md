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

Nothing is open. Every item that was listed here shipped:
- S7 mobile dependencies: #1069.
- SEO3 canonical and hreflang: #1071.
- SEO4 redirects, sitemap lastmod and robots: #1072.
- W1–W4 Worker hardening (client IP header, HSTS, no-framing, SHA-pinned Actions): #1031. `GUILDED_ORIGIN_TOKEN` is set on the bot.
- R1.7 analytics: #1040, with the beacon live on guildedwow.com.
- R2.6 phone app page: #1153.
- R2.7 visual regression in CI: #1292 (Playwright, `.github/workflows/visual.yml`, `docs/VISUAL_REGRESSION.md`; leaderboards are bot-served and skipped, `/fr/download/` is checked as `?lang=fr` plus a slug test).

## In progress

_Empty. Format: item id, PR link, who._

## Done

_Format: item id, PR, release._

Moved here in the 16 November 2026 audit (checked against main). Items marked superseded were not built as written.

- **S2**: superseded by the owner decisions of 14 Nov 2026 (single-report runs are ranked; one witness is enough; #872, docs/plans/SINGLE_WITNESS_2026-11-13.md). Not built.
- **S3**: superseded by the same decisions; plausibility checks already exist (`src/services/run-plausibility.ts`, #872). Not built as specified.
- **SEO1**: superseded by R1.6 (French pages at `/fr/`, #756) and the redirect table (#820, #831).
- **SEO2**: superseded: guildedwow.com is the main site (#776); `canonicalRedirect` in `worker/index.mjs` handles the old hosts.
- **CF1**: #894, #937, #957, #1007 (pointer kept current; 9.3.5 files).
- **R0.1**: #737
- **R0.2**: #738
- **R0.3**: #739
- **R0.4**: #743
- **R0.5**: #740
- **R0.6**: #741
- **R0.7**: #742
- **P1**: #748 (site), #755 (companion)
- **R1.1**: #745
- **R1.2**: #751
- **R1.3**: #752
- **R1.4**: #749
- **R1.5**: #750
- **R1.6**: #756
- **R2.1**: #753
- **R2.2**: #754
- **R2.3**: #757
- **R2.4**: #758
- **R2.5**: #759

- **S1** (bot side): `clientAddress()` uses `x-guilded-client-ip` only when the peer is loopback and `x-guilded-origin` equals the `GUILDED_ORIGIN_TOKEN` environment variable (`timingSafeEqual`, length-checked); otherwise it falls back to `x-forwarded-for`. The variable is new on the bot: set it to the same value the Worker sends (`GUILDED_ORIGIN_TOKEN` secret) in the bot's environment, or the header stays ignored. `recordFailure` is called only for a present, well-formed credential. W1 (Worker sets the header) is still open (Grok Bot). PR: branch `claude/security-queue-s1-s8`. Release: not yet.
- **S4**: the Discord client defaults to `allowedMentions: { parse: ["users"], repliedUser: false }`; the two role-ping sends (LFG group post, invite-notify role ping) already pass explicit `roles`. PR: same branch. Release: not yet.
- **S5**: `selfRoleProblem` refuses any role that is a Guilded permission role (EN/FR names, Class Leader variants, scoped role ids); callers pass the role name. PR: same branch. Release: not yet.
- **S6**: `replyWithCommandError` shows `error.message` only for `isMemberAnswer(error)`. PR: same branch. Release: not yet.
- **S8**: `deploy/Caddyfile` log filter deletes the `key` query parameter from `request>uri`. PR: same branch. Release: not yet (copy the Caddyfile to the server on deploy).
