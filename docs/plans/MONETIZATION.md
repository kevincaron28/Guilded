# Monetization plan (ROADMAP item 6)

Status: **plan only, 7 November 2026.** Nothing here is built. The owner picks; this document recommends.

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
- Payouts depend on supported countries/locales; check Canada is supported for the owner's team before designing around it.

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

## Recommendation

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

1. Is Canada a supported payout country for Discord's team payouts today? (Check the Developer Portal Monetization tab.)
2. Does the owner want any recurring income at all, or is "costs covered" the goal? A rough budget (host + DB + domain + store fees, perhaps C$40-80/month) would set the target; that would be 10-20 monthly supporters.
3. Willing to get a short legal read on the PolyForm wording before any paid tier (D/E)?

## Sources

- Blizzard: [UI Add-On Development Policy](https://us.forums.blizzard.com/en/wow/t/24534); [WoW China crackdown](https://www.icy-veins.com/wow/news/wow-china-cracks-down-on-paid-addons-and-paywalled-profiles/)
- Discord: [monetization overview](https://docs.discord.com/developers/monetization/overview), [enabling monetization](https://docs.discord.com/developers/monetization/enabling-monetization)
- Licence text: [PolyForm Noncommercial 1.0.0](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0)
- Platform fees: [Patreon vs Ko-fi 2026](https://app.unil.ink/blog/patreon-vs-buymeacoffee-vs-kofi-2026) (vendor blog; verify on the platforms' own pricing pages)
