# PoE2 parser fixtures

`lifecycle.txt` is a **synthetic** sequence, not a captured play session. Tests
convert it to CRLF as well as LF. It covers campaign, hideout, a map, re-entry,
localized surrounding messages, ignored chat/death text and a disconnect.
The localized strings are synthetic; this does not establish French-client support.

The MapLoftySummit generation shape has historical first-hand evidence in
https://www.pathofexile.com/forum/view-thread/3853562 (14 September 2025 log).
Timestamps, process IDs and seeds here are invented test values. Map ID shape
tests with digits/underscores are grammar tests, not claims about current maps.

Still required: a current-patch, consented and sanitized real capture in English
and French. Record patch, locale, capture date and expected manual observations.
Remove chat, account/character names and paths before committing; preserve event
order, CRLF and consistent substituted seeds. Capture campaign -> hideout -> map
-> hideout -> same map -> disconnect, and separately a new map instance. The
pilot must verify 1 map / 2 portal entries before claiming seed stability.
