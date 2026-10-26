# 7.5.0 launch-week addon tools: test checklist

Nine addon-only features, built before WoW Forever launches (4 November 2026) and shipped in
7.5.0 so they can be tested in game from launch day. They are covered by the Lua tests
(`tests/lua/launch-tools.test.ts`, `tests/lua/ledger-sync.test.ts`), but only the game can
confirm the client APIs they use. They change nothing in the bot, the companion, Discord or
the protocol version.

Each check names what to do and what should happen. Record results next to each line
(pass / fail / not available on this client) and which edition was used.

## Officer, one PC

1. **Officer tools page.** `/guilded menu`, Guild group, **Officer tools**: seven buttons. Esc >
   Options > AddOns > Guilded: the switch list scrolls and shows the six new parts.
2. **Guild event log.** Log in, wait 20 s, `/guilded guildlog`. Expect the recent joins,
   promotions and leaves as the game's own sentences. `/reload`, run it again: no duplicates.
   If it says the client has no guild log, record that (the API may be absent on Forever).
3. **Guild bank.** Open the guild bank, click through each tab, close it. `/guilded gbank`
   shows the date, item count and gold; `/guilded gbank <item>` finds an item; `copy` pastes
   into a spreadsheet with four columns. Era has no guild bank: expect the "no guild bank" line.
4. **softres.it import.** Make a test raid on softres.it, add two reserves, copy the CSV export.
   `/guilded import softres`, paste, Import. Expect "Imported 2 reserve(s)..." and the Reserves
   tab showing them; hover the item: "Reserved by". Repeat with the Gargul export string (it
   needs `C_EncodingUtil`; if the client lacks it, the message says to paste the CSV).
5. **That's My BiS.** `/guilded import tmb`, paste `19019,Alice,Bob` (or a real Gargul export).
   Hover that item: "That's My BiS: 1. Alice, 2. Bob". `/guilded import tmb clear` removes it.
6. **Consumable penalty.** `/guilded start Test`, `/guilded consumes penalty 50`, group with
   someone without a flask, `/guilded consumes`, `/guilded award group 10 test`. They get 5 EP
   and the reason ends with "-50%". `/guilded void` the test entries afterwards, then
   `/guilded consumes penalty 0`.
7. **Speed recorder.** `/guilded perf on`, play a few minutes (open the window, sync),
   `/guilded perf`. Expect timings per event and command. `/guilded perf off`.

## Two PCs (officer + second account)

8. **Welcome whisper.** Officer: `/guilded welcome on`. Invite a fresh character to the guild:
   it gets one whisper with the guild name filled in. With two officers on, still one whisper.
   `/guilded recruit list joined` shows them if they were added with `recruit add` first.
9. **Pug check.** `/guilded pugcheck on`, group with a character outside the guild, out of
   combat and in range. Expect one line with class, item level, missing enchants.
10. **Main names in chat.** Needs a synced companion with a member who has an alt linked in
    Discord. `/guilded chattags on`, the alt says something in guild chat: the line starts
    with "(Main name)".
11. **Ledger sync batches.** In-game-only guild, both officers `/guilded ledgersync on`.
    One officer awards several entries on one day, `/guilded ledgersync now`. Both show the
    same totals; with `/guilded perf on` the GuildedLedger line shows a few messages instead of
    one per entry. Repeat with one client that lacks `C_EncodingUtil` (if any edition does):
    entries still arrive, one message each.

## Known limits

- The guild log stores approximate times (the game gives ages in hours).
- The guild bank keeps a tab's previous contents when the server had not sent that tab yet;
  the tab keeps its own date.
- A player whose buffs cannot be read is never penalized.
- The pug check never inspects in combat or while you have the inspect window open.
