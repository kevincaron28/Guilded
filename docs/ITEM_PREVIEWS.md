# Discord-only WoW item previews (off by default, not tested live)

Implements the offline-safe part of the ROADMAP item "WoW-linked Discord item previews". Blizzard's
own relay is untouched. **Nothing here has run against Discord or a WoW client.** The feature is inert
until an owner enables it for a server.

## What is built

- `src/services/item-links.ts`: scans text (no regex over the message; caps: 2000 chars scanned, 5 items,
  60-char names) for raw links `|Hitem:id:enchant:...:suffix:...|h[Name]|h` (verified numeric id, enchant,
  random suffix, quality colour) and bracket-only `[Name]` (name only, **unverified**). De-duplicated.
- `src/services/item-preview-data.ts`: `ItemDataProvider` interface with a **null default**, a TTL cache
  (never looks up by name alone), and a per-channel rate limit (6/min) plus a 2-minute duplicate window.
- `src/services/item-preview-embed.ts`: compact embed; name sanitised (mentions, markdown, control
  characters); Wowhead classic URL only from a verified numeric id; `allowed_mentions: {parse: []}`.
- `src/services/item-preview-webhook.ts`: posts with `wait=true`; 401/404 disables the server's
  previews, 429 honours retry-after (per-server back-off), results never contain the URL or token.
- `src/services/secret-box.ts` (AES-256-GCM, no earlier helper existed) keyed by new env
  `ITEM_PREVIEW_SECRET` (32+ chars). The webhook URL is stored only as ciphertext in the new
  `ItemPreviewConfig` table (migration `20261213000000_item_preview_config`).
- `src/services/item-preview.ts` + a `MessageCreate` handler in `src/main.ts`, registered only when
  `MESSAGE_CONTENT_INTENT=true`, honouring `hostedPilot.allows`. It ignores the bot itself and the
  preview webhook itself. **Other bots/webhooks are deliberately not skipped**: the Blizzard relay is
  probably one, and skipping it would defeat the feature. The preview webhook's id is stored for the
  loop check.
- Owner-only `/guilded-previews enable|disable|delete|status` (home server only, like
  `/guilded-season`; the `/setup` and `/config` size limit is untouched).

## What is NOT verified / not built

- Whether the bot receives the relayed messages with content, and whether item links reach it as raw
  links (id kept) or only as `[Name]` text. If only names arrive, previews are name-only and labelled
  "Unverified", with no stats or link.
- Whether a webhook can post in the Blizzard-linked channel and whether the post echoes into WoW.
- **Data source decision still needed.** No item database is in the repo and none was scraped. Until
  the owner picks a legal, accurate source for Forever (including changed items) and implements an
  `ItemDataProvider`, embeds carry only what the link itself says (id, suffix, enchant, colour).
  The Wowhead URL is a plain link, not scraped data; confirm Forever's id space matches `/classic/`.

## Owner-run live tests (do these before enabling for real)

1. **Feasibility.** With `MESSAGE_CONTENT_INTENT=true`, post an item link in WoW guild chat and check
   the Discord message in `#chat-guilde`. Temporarily log only `message.content.length` and whether it
   contains `|Hitem:` (never the text); remove afterwards. Record raw link vs bracket-only.
2. **Webhook and non-echo.** In that channel create a *temporary* webhook (Channel settings >
   Integrations). Run `/guilded-previews enable` with it, then link `[Training Sword of the Owl]`,
   a normal item, an unknown item and several items in one message, plus a rapid duplicate. Confirm the
   embed shows in Discord and **does not appear in WoW guild chat**. Also try a revoked webhook (delete
   it in Discord): the next link must turn the feature off ("webhook rejected (404)" in `status`).
   Afterwards run `/guilded-previews delete`, delete the webhook in Discord and remove the test posts.
   If the channel blocks webhooks, record the status and stop; do not work around it.

Enable needs `ITEM_PREVIEW_SECRET` set and the bot restarted. The webhook URL typed into the command is
visible to you only (ephemeral reply) but stays in your client's input history: use a temporary one.

## Rollback

`/guilded-previews disable` (instant, keeps config) or `delete` (erases the stored ciphertext), then
delete the webhook in Discord. Unsetting `MESSAGE_CONTENT_INTENT` also stops the handler.
