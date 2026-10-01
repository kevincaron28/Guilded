# Shared Guilded support hub

Guilded 5.0.0 keeps the product help separate from game activities. Fresh setup creates **⚜️ Guilded** in both languages. Earlier **⚜️ Guild** and **⚜️ Guilde** categories remain recognized; setup reuses and renames them rather than creating a duplicate. The category explicitly allows everyone to read, including servers whose default visibility is hidden.

The guide is readable by every member, with posting restricted to bot/officers. **bot-faq** lets every member ask about the bot, addon and companion. Installation answers reuse the pinned guide and work without AI. That guide explains the supplied guild ZIP, correct AddOns folder, personal companion pairing and saved-file synchronization; it does not imply that the unpublished 5.0 build is available on CurseForge.

Raid/boss announcements belong to the raid category. Organizing existing game/staff channels preserves their full overwrites instead of resetting them to general server visibility. Craft-board repair retains an existing View Channel deny. Newly created raid cores still use the guild viewer model: a complete configurable per-game role model is separate remaining work.

In a recognized Guilded category (or when the parent cannot be resolved), the answer listener uses public product documentation and public officer FAQ answers. It does not query personal records, raid/core schedules, loot, recruitment or operational guild facts to publish in shared chat. Custom FAQ answers are public text and must be written accordingly. A configured answer channel outside the support category retains its existing guild-answer behavior. AI stays optional and is still limited per member/day. Message Content must already be allowed in the Developer Portal before enabling the environment setting; the update never makes that privileged intent unconditional.

The Québec guild's current priority is finishing WoW, then implementing PoE 2 competition. Diablo IV channels and season remain deferred. This change does not create or enable a PoE or Diablo competition.

Validation: fresh/recovered shared FAQ, legacy category reuse, readable/readonly guide on a hidden server, retained raid visibility on organize, retained craft gate on repair, deterministic install help, no private database facts in shared AI requests, missing-parent fallback and complete replies within Discord text limits. Run the full repository checks and required release gates before redeploying. A real member question in bot-faq is the final end-to-end check; a local second gateway bot is never started.
