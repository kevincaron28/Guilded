# Optional support setup for the owner — 15 October 2026

## Current verified setup

- Official public page: [Guilded by KCaron](https://ko-fi.com/wowguilded).
- The owner-authorized profile update uses the existing Guilded logo, an English
  and French project description, and the Guilded website link.
- Payment settings show **PayPal connected**. Stripe is not connected; do not
  advertise Stripe, Apple Pay or Google Pay as available.
- Currency is **Canadian dollars (CAD)**. The existing minimum is **C$5**.
- One-time support is the default; monthly tips remain an optional supporter choice.
- Switched from Standard to **Ko-fi Free**: 0% Ko-fi fee on one-time tips.
  Monthly tips still have a 5% Ko-fi fee. PayPal processing and any currency
  conversion fees still apply.
- The public page visibly shows **Tip CA$5**. No money was sent and no paid
  transaction was performed. Actual receipt of a tip remains untested.
- Public site links are maintained in [SUPPORT_GUILDED.md](SUPPORT_GUILDED.md)
  and the landing page. [CurseForge copy](CURSEFORGE_COPYPASTE.md) is prepared
  repository text; its external listing must be updated separately.

Do not publish payment-account email addresses or payment credentials in the
guides, source or deployment evidence. A custom domain is a separate setup step;
keep the verified Ko-fi destination until the owner selects and registers one.

## Original setup guidance (9 October 2026)

Recommendation: **Ko-fi Free, one-time tips, connected to the owner's PayPal**.
No monthly Ko-fi subscription is needed. Use a public Guilded creator page rather
than publishing a personal email address as the payment destination.

## Fees and alternatives

- Ko-fi Free: 0% Ko-fi service fee on one-time tips; PayPal/Stripe processing and
  any applicable conversion fees still apply. Monthly tips and memberships have
  a 5% Ko-fi fee. New accounts may start in Standard/Contributor mode: opt out of
  **Get all of Ko-fi** in Payment settings for the free one-time-tip option.
- Buy Me a Coffee charges a 5% platform fee; it is less attractive for this pilot's
  simple one-time support flow.
- A direct PayPal support link is another option, but Ko-fi gives Guilded a public
  explanation, goal and support page without exposing an email link in the guides.

Sources checked 9 October 2026:
[Ko-fi fees](https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee),
[Ko-fi payouts](https://help.ko-fi.com/hc/en-us/articles/115003980093-How-do-I-get-paid),
[Buy Me a Coffee fees](https://help.buymeacoffee.com/en/articles/4539170-frequently-asked-questions).

## Owner setup

1. Create or choose a Ko-fi creator page with a Guilded-related name; availability
   has not been checked. The owner completes account terms and PayPal connection.
2. Choose Ko-fi Free / disable Standard or Contributor mode. Start with one-time
   tips, no membership tiers or paid access.
3. Use CAD if it matches the receiving account and most supporters. A suggested
   C$5 one-time tip is a starting preference, not a required amount.
4. Preview the supporter checkout and verify what personal name/email PayPal
   displays before publishing the link. Do not promise anonymity.
5. Publish the verified public URL in `docs/SUPPORT_GUILDED.md`, the site Support
   link destination and the CurseForge description. Only configure CurseForge's
   donation field if its supported method matches the actual account.

Suggested creator-page text:

> Help keep Guilded running. Optional tips support hosting, backups, maintenance
> and future capacity for this small community project. The addon and approved
> hosted pilot remain free. Supporting Guilded does not buy approval, priority,
> extra permissions or guaranteed uptime. Thank you for helping us maintain it.

Describe support as funding hosting, PostgreSQL, backups, maintenance and future
capacity. Do not invent a monthly bill, fundraising target or paid-support promise.
The older statement that no payment page was configured is superseded by the
verified setup above.
