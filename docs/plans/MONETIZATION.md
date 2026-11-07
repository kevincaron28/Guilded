# Monetization plan (ROADMAP item 6)

Status: **plan only, 7 November 2026 (second pass: Lite and paid editions added below).** Nothing here is built. The owner picks; this document recommends.

Jump to: [Lite and paid editions](#lite-and-paid-editions-second-pass-7-november) | [Recommendation](#recommendation)

## Where we are today

- A Ko-fi page exists ([Guilded by KCaron](https://ko-fi.com/wowguilded)), Ko-fi Free plan, PayPal connected, CAD, C$3 "coffee" and C$5 minimum. One-time tips cost 0% Ko-fi fee; monthly tips cost 5%. Set up in `docs/DONATION_SETUP.md`, copy in `docs/SUPPORT_GUILDED.md`. The CurseForge Donate button points at it. Actual receipt of a tip is still untested.
- Costs are small: Oracle host, Aiven PostgreSQL, domain, Cloudflare (free tier), Store/Apple/Google developer fees if the phone app ships.
- Licence: PolyForm Noncommercial 1.0.0. The addon is "free for noncommercial use".

## The constraints that decide everything

### 1. Blizzard's UI add-on policy
Blizzard's UI Add-On Development Policy (2009, still the reference) says add-ons must be **free of charge**, in clear code, and **must not solicit donations in-game** or show third-party ads. Enforcement in US/EU has been loose, but Blizzard China recently told platforms to remove paid addons, and the policy is the thing CurseForge/WoWInterface point to. Sources: [Blizzard forum policy thread](https://us.forums.blizzard.com/en/wow/t/24534), [Icy Veins on WoW China](https://www.icy-veins.com/wow/news/wow-china-cracks-down-on-paid-addons-and-paywalled-profiles/). Mythic Dungeon Tools' paywalled dungeon data drew [community attention](https://www.wowhead.com/news=320230/mythic-dungeon-tools-paywalled-dungeon-data-available-to-subscribers-only) for exactly this reason.

Consequences for Guilded:
- **Nothing inside the addon may be locked, gated, nagged or advertised for money.** No "supporter" flag read by Lua, no donate button or text in the Guilded window, no supporter-only addon module.
- A donate link on the CurseForge page, the website and the companion app is the usual accepted practice (the policy targets the add-on itself). Keep it out of the addon, its tooltips and chat output.
- Features that live in the **bot, website or phone app** are outside the addon, but a perk that makes the *addon* behave differently (via companion sync) is a grey zone. Avoid it.

### 2. PolyForm Noncommercial 1.0.0
The licence grants use for "noncommercial purposes" and does not define donations or perks. Guilds using Guilded for their own community is the intended use. Risks to be aware of (not legal advice; confirm with a lawyer before charging):
- **Donations** to the author are the ordinary case for noncommercial hobby software; low risk.
- **Selling subscriptions** to the *same code* arguably makes the *author's* operation commercial, but the author owns the copyright and is not bound by their own licence. The real issue is that the licence then reads oddly ("free for noncommercial use" while a paid tier exists), and a **guild that pays you** for a premium tier is arguably making a commercial arrangement with you, which is yours to license. If the project ever sells access, add a short written statement: paid features are offered under a separate commercial licence from the owner, and the PolyForm grant for the open parts is unchanged.
- Nobody else may sell or host a paid version; that already follows from the licence.

### 3. Discord rules
Discord's app monetization is available to **verified apps on a developer team** with payouts configured and 2FA on all team members; offerings are SKUs (user subscription, guild subscription, one-time purchase) and Discord's policy requires that paid offerings are also available through its Premium App features and priced no higher than elsewhere ([overview](https://docs.discord.com/developers/monetization/overview), [enabling monetization](https://docs.discord.com/developers/monetization/enabling-monetization)). I could not confirm the exact revenue share from public pages; Discord points to its Monetization Terms, so read those before committing. Practical effects:
- Selling perks *in Discord* means using Discord's SKUs, not a link to Ko-fi/Patreon, once a perk is gated inside the bot.
- A verified bot needs Discord's verification (the bot is in few servers, so this is fine today but it is a gate).
- Payouts depend on the team's country: Discord's docs (7 November) list US, EU and UK teams only, so **Canada is not supported today**. See the second pass below.

### 4. App stores (if the phone app sells anything)
Apple and Google require their own in-app purchase for digital goods inside the app (Apple 3.1.1), 15-30% fee. Avoid selling anything inside the phone app; a donate link is the only safe path, and Apple has its own rules about external links per region. This is also why the TCG plan has no real-money purchases ([APP_TCG.md](APP_TCG.md)).

## Options

| # | Option | Licence | Blizzard | Discord | Effort | Realistic revenue (small community) |
| --- | --- | --- | --- | --- | --- | --- |
| A | **Donations: Ko-fi tips** (have it) | fine | fine outside the addon | no Discord involvement | done; polish only | C$10-60/month if promoted; most months near zero. A 238-member guild gives a handful of tips a year |
| B | **Ko-fi/Patreon memberships with Discord role sync** (a "Supporter" role, name on a thanks wall) | fine | fine (cosmetic, outside addon) | role sync via Patreon/Ko-fi's own Discord integration; no bot work | 1-2 days incl. a thanks page | 5-20 supporters x C$3-5 = C$15-100/month. Patreon takes about 8-12% plus processing; Ko-fi memberships 5% + processing ([comparison](https://app.unil.ink/blog/patreon-vs-buymeacoffee-vs-kofi-2026)) |
| C | **Cosmetic perks** for supporters: bot card themes (extra frames/backgrounds in `score-card.ts`), a supporter badge on the website/phone profile, custom share-card flair | fine | fine if cosmetics are bot/web/app only, never in the addon | needs role/SKU check; if sold in Discord must use SKUs | 3-5 days for a theme set + entitlement check | small uplift on B (cosmetics convert 1-3% of an active audience) |
| D | **Guild premium (bot features)**: per-guild paid tier for higher limits (history depth, extra boards, bigger card packs, priority support) via Discord guild subscription SKU | needs the commercial-licence statement above | OK only if every addon feature stays free; premium = bot/site only | native SKU, verified app, team payout | 2-4 weeks (entitlements, gating, billing, support, terms of service, refunds) | maybe 3-10 guilds x C$5-10/month = C$15-100; support load likely outweighs it |
| E | **Discord user subscription** ("Guilded Plus") | as D | as D | same | 2-3 weeks | like B but with Discord taking its cut; only worth it if members already live in Discord and will not click a Ko-fi link |
| F | **Sponsor/ads** on the website | fine | n/a | n/a | low | negligible traffic; hurts the clean look. Avoid |
| G | **Paid addon features / early access** | fine | **violates policy** | n/a | n/a | **Do not** |
| H | **Selling in the phone app** (packs, cosmetics) | fine | n/a | n/a | high | store fees plus loot-box disclosure; **do not** |

## Lite and paid editions (second pass, 7 November)

Owner question: "Analyse and plan a Discord bot and system lite version and a paid version."

### What exists, and a naming clash to fix

- **Self-hosting is free and stays free.** The code is public under PolyForm Noncommercial; a guild can run its own bot ([GETTING_STARTED.md](../GETTING_STARTED.md)). Paid editions are about the **hosted** bot only.
- **"Guilded Lite" already exists, but it is a waiting room, not a product tier** ([HOSTED_PILOT.md](../HOSTED_PILOT.md), `src/commands/lite.ts`): a server that adds the bot gets a short command list (`/setup start`, `/help`, `/mod faq`, `/report`, `/dungeon group`, basic raid signups) until the owner approves it, up to `HOSTED_LITE_LIMIT` (50) servers; approval then unlocks everything, free. The English page says 50 places, the French page says five servers; one of them is stale and should be corrected whichever plan is chosen.
- Hosted today: Québec Gold, Vanguard and K Caron Projects. A paid tier has no market at that size; the plan below is what to build **if** demand appears, and what to prepare now so it is cheap to add.

To avoid confusing the waiting room with a product, this plan renames the pieces:

| Name | Meaning |
| --- | --- |
| **Waiting room** (today's "Lite") | Unapproved server, short command list. Keep as is, rename in copy later |
| **Lite** | The free hosted edition: a permanent, useful tier for any approved server |
| **Plus** | The paid hosted edition, per Discord server |
| **Founding** | Existing approved servers at launch of Plus: Plus free for 12 months, then they choose |
| **Self-hosted** | Everything on, no billing code active (`PLANS_ENABLED=false`, the default) |

### The rule that draws the line

Free versus paid follows **cost and officer workload, never member fairness or the addon**:

1. **Everything the addon, the companion or a member's own profile needs stays in Lite.** The addon is free of charge by Blizzard policy, and a feature that changes what the addon shows because of a payment is a grey zone ([constraint 1](#1-blizzards-ui-add-on-policy)). So linking, addon and companion sync, EP/GP standings and the loot ledger the addon displays, achievements, ladders and the phone app are **not gated**.
2. **Members never pay.** A member in a Plus server sees the same thing as a member in a Lite server for everything about themself. Plus buys officers extra tools and higher limits, not advantages in raid or loot fairness.
3. **Public community features stay free** (public leaderboards, the season race, Hall of Fame, guild public page basics): they are the shop window and the network effect.
4. **Gate things that cost real money or support time:** scheduled jobs and rendering at scale, long history, exports, branding, the heavier officer tools, and priority help.

### Tiers

| Area | Lite (free, hosted) | Plus (paid, per server) |
| --- | --- | --- |
| Setup, `/help`, FAQ, bug reports | All | All |
| Account linking, companion and addon sync, member profiles, achievements, call for help, guildmate map | All | All |
| Raid sign-ups | Create, sign up, status, roster; up to 4 open raids at a time | Raid cores, weekly repeats, attendance records and reports, no cap |
| EP/GP standings and ledger | Standings, ledger, officer edits | Same, plus ledger export (CSV) and decay/anniversary reports |
| Dungeon runs, leaderboards, seasons | Current season, public boards | Season history archive, per-core boards, season-end recap posts |
| Share cards | Standard WoW theme | Extra themes, guild crest and colours on cards, custom footer (no ads) |
| Automation | Manual commands; reminders for raids you created | Scheduled weekly reports, digest posts, auto-roles by rank, recruiting kit scheduling |
| History kept | 90 days of activity and attendance detail (totals kept forever) | Full history |
| Officer tools | Core set | Officer analytics page, participation points, community activities, polls with history |
| Website | Guild public page | Custom page header, link-in-bio card, vanity path |
| Companion profiles | Up to 40 linked characters synced per server | Unlimited |
| Support | Community help, bug reports | Priority queue (answered within 2 days), a named contact; no uptime promise beyond the terms page |

Notes: the Lite limits (4 open raids, 40 characters, 90 days of detail) are chosen to fit a small guild and push only larger or more serious guilds to Plus; they must be tested against what Québec Gold uses so no active guild hits a wall by surprise. If any limit looks mean in practice, move it to Plus-only convenience (history, export) instead of capping members.

### Pricing

| Plan | Price | Notes |
| --- | --- | --- |
| Lite | Free | Hosted capacity permitting (the existing approval and `HOSTED_LITE_LIMIT` logic) |
| Plus monthly | **US$5 per server per month** | Discord guild subscription SKU |
| Plus yearly | **US$50 per server per year** (two months free) | Only if Discord offers a yearly interval on the SKU: check the SKU options |
| Founding | Plus free for 12 months, then the above | Existing approved servers |
| Supporters (Ko-fi) | As today | Cosmetic, outside the addon; separate from Plus |

Why US$5: an officer team splitting it is about a dollar each, and it is in line with small bot subscriptions. Break-even maths: costs are about C$40-80 per month (about US$30-60). If Discord plus Stripe take 15-30% in total (not confirmed; see below), a US$5 server nets about US$3.50-4.25, so **8 to 17 paying servers cover costs**. With three hosted servers today this is not reachable yet, which is why the recommendation stages it.

### How Discord monetization applies

Confirmed from Discord's developer docs on 7 November ([overview](https://docs.discord.com/developers/monetization/overview), [enabling monetization](https://docs.discord.com/developers/monetization/enabling-monetization)):

- Offers are **SKUs**: one-time purchases or subscriptions; subscriptions are either **user** subscriptions (only the buyer is entitled) or **guild** subscriptions (every member of that server is entitled). Plus is a **guild subscription** SKU. Access is read from **entitlements** (the bot checks them; Discord sends entitlement create/update/delete events, and the bot should also reconcile at startup).
- To enable it, the app must be **verified**, belong to a **developer team**, use slash commands, have **Terms of Service and Privacy Policy links**, the team owner must be **18+**, the team needs verified emails and **2FA**, and the team agrees to the Monetization Terms and the Developer Policy.
- Payouts go through **Stripe**, are configured by the team owner, need **US$100 earned** first, and begin after a Discord review.
- **Payouts are available directly to teams based in the United States, the EU or the UK.** Canada is not on that list. **This answers the old open question 1: as a Canadian team owner the owner cannot be paid out directly today.** Options: put the app under a team whose owner is based in the US, EU or UK (a trusted person or a registered entity there); wait for Discord to add Canada (the docs say it is expected to widen); or sell outside Discord (below). Check the Help Center article on Premium Apps payouts for non-listed regions before deciding.
- Not confirmed from public pages: Discord's **revenue share**, **price-parity** and **refund** rules, and who is merchant of record for sales tax (GST/QST). These sit in the Monetization Terms; read them before any announcement.

If selling through Discord is blocked or poor value, the fallback is Ko-fi or Patreon memberships with the guild's owner entered by hand (a per-server `plan` set by the owner after payment, no Discord SKU). That is workable at 5-10 servers, but Discord's rules about offering paid perks of a bot through other channels must be checked first, and it adds manual work and refunds.

### Technical shape (when built)

- **One switch point.** A single `src/services/plans.ts` with `planFor(guildId)` and `hasFeature(guildId, feature)`; every Plus command, job and page asks it. No scattered checks. Self-hosted (`PLANS_ENABLED=false`) returns "all on".
- **Data.** `GuildPlan { guildId, plan: "lite" | "plus" | "founding" | "comp", source: "discord" | "manual" | "founding" | "comp", validUntil, discordEntitlementId?, updatedAt }`. One hand-written migration, no change to existing tables.
- **Sync.** Gateway entitlement events plus a startup and daily reconcile against `GET /applications/{id}/entitlements`; Discord's test entitlements for QA. A lapsed subscription drops to Lite after a 7-day grace period; data is never deleted.
- **In Discord.** A Plus-only command answers with an ephemeral message naming the feature and showing Discord's premium button. No pop-ups in channels, no DMs, no countdowns, no automatic posts (repo rule).
- **Never in the addon.** No Lua reads the plan. The companion shows no upsell. The website and bot are the only places the word "Plus" appears.
- **Terms and privacy.** A short terms page (what Plus includes, the support target, refunds as Discord's terms require, that the hosted bot is provided as is, the commercial-licence statement from constraint 2) and a privacy line. Required by Discord for monetization.
- **Language.** Everything bilingual from the first release (the repo already ships English and French; a paid offer in Québec should not be English-only).

### What stays free for members, in one list

Linking and the companion, the addon in full, EP/GP standings, achievements and the album, ladders, public boards, the season race and Hall of Fame, call for help and the guild map, raid sign-ups, dungeon groups, the phone app, character pictures, FAQs, bug reports, and the right to delete their data. None of it depends on whether their server pays.

### Migration for existing servers

1. **Ship the plumbing first, with no visible change.** `GuildPlan` and `hasFeature` exist; every server is `founding` or `comp`, so every check returns true. Nothing a server uses today disappears.
2. **Québec Gold is `comp` permanently** (the owner's guild; also the reference server for testing Lite limits by temporarily switching a test server to Lite).
3. **Vanguard and K Caron Projects are `founding`:** Plus free for 12 months from the Plus launch date.
4. **Announce 60 days before anything is gated**, in the bot guide channel (the existing version-announce mechanism, one post, never repeated) and on the site. State exactly what moves to Plus, with the Lite limits.
5. **New servers after launch start on Lite**, with the waiting-room approval flow unchanged underneath.
6. **At the end of Founding:** the server owner sees one ephemeral notice the next time an officer runs a Plus command; no DM, no channel post. Data above the Lite limits stays stored (read-only in views that Lite cannot show) for 90 days, then only the Lite window stays visible; nothing is deleted without the existing Delete my data flow.
7. **Rollback:** setting a server back to `comp` or turning `PLANS_ENABLED` off restores everything instantly.

### Stages and gates

| Stage | Do | Gate to continue |
| --- | --- | --- |
| 0 (now) | Option A+B below; fix the 50-versus-five wording; decide the naming | none |
| 1 | Build `GuildPlan` + `hasFeature` with everything on (about 3 days), plus terms and privacy pages (1 day) | owner agrees to the line in "The rule that draws the line" |
| 2 | Resolve the **payout country** question and read the Monetization Terms; start the verification and team requirements | A US/EU/UK payout route exists, or Discord adds Canada |
| 3 | Gate the Plus features, wire entitlements, French copy, test entitlements (about 2 weeks) | At least 5 servers outside Québec Gold using the hosted bot, or a guild asks to pay |
| 4 | Launch with a 60-day notice to Founding servers | Break-even of 8-17 paying servers is realistic |

Total effort for stages 1-3 is about 3 weeks for one developer. The honest read: **do stage 1 now (it also helps capacity control), and do not do stages 3-4 until stages 2 and the demand gate are met.**

## Recommendation

0. **Lite and paid editions:** prepare, do not launch. Do stage 1 above (plan flag, terms and privacy pages, everything on). Launch Plus only when a payout route exists and at least five outside servers are using the bot. Until then the Lite/Plus split is a design on paper, and the donations below carry the costs.

1. **Do A + B, no more.** Keep the Ko-fi page, add a plain **Supporters** page on the website (opt-in names, no tiers of power), and a Ko-fi/Patreon-linked "Supporter" Discord role in Québec Gold. Everything is cosmetic or thanks, outside the addon. Cost: about two days. Add one honest line to the Ko-fi page about what the money covers (hosting, database, backups, store fees).
2. **If the owner wants perks, do C later and only cosmetic and only on bot/web/app surfaces**: extra share-card themes and a supporter flair. It is cheap and carries no policy risk. Do it only after the phone app and cards are stable.
3. **Revisit D only if a guild asks to pay.** Then write the commercial-licence statement and use Discord guild subscriptions rather than invoicing.

## What to avoid

- Any paywall, supporter check, nag text or donate prompt **in the addon** (Blizzard policy; CurseForge can pull the project).
- Real-money purchases in the phone app (store fees, loot-box disclosure, and it would undermine the free ethos).
- Selling EP/GP, rank, loot priority or anything that changes raid fairness. Never pay-to-win in guild systems.
- Ads and tracking on the website.
- Promising uptime or support levels to payers without a written terms page.
- Auto-posting thanks to Discord without opt-in (the repo already forbids unrequested automatic messages).

## Open questions for the owner

1. ~~Is Canada a supported payout country?~~ Answered 7 November: Discord's docs list US, EU and UK teams only. Does the owner have a route (a US/EU/UK-based team owner or entity), or should this wait for Discord to add Canada?
1b. Does the owner agree with the line for Lite and Plus (addon and member features free, officer power and scale paid) and with US$5 per server per month?
1c. Should existing hosted servers be Founding (12 months of Plus free) and Québec Gold permanently comped?
2. Does the owner want any recurring income at all, or is "costs covered" the goal? A rough budget (host + DB + domain + store fees, perhaps C$40-80/month) would set the target; that would be 10-20 monthly supporters.
3. Willing to get a short legal read on the PolyForm wording before any paid tier (D/E)?

## Sources

- Blizzard: [UI Add-On Development Policy](https://us.forums.blizzard.com/en/wow/t/24534); [WoW China crackdown](https://www.icy-veins.com/wow/news/wow-china-cracks-down-on-paid-addons-and-paywalled-profiles/)
- Discord: [monetization overview](https://docs.discord.com/developers/monetization/overview), [enabling monetization](https://docs.discord.com/developers/monetization/enabling-monetization)
- Licence text: [PolyForm Noncommercial 1.0.0](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0)
- Platform fees: [Patreon vs Ko-fi 2026](https://app.unil.ink/blog/patreon-vs-buymeacoffee-vs-kofi-2026) (vendor blog; verify on the platforms' own pricing pages)
