# Screenshot shot list (ROADMAP item 20)

Screenshots for the two website guides, [Install Guilded](../site/pages/guide-install.md) (`/guides/install/`)
and [Link your character](../site/pages/guide-link.md) (`/guides/link/`), each also in French
(`guide-*.fr.md`). The pages already contain a marked placeholder per shot: an `<img>` pointing at
`/assets/guides/<name>.png` that shows "Screenshot coming soon" until the file exists. **No fake images
are committed.** To finish a shot: save the PNG as `site/assets/guides/<name>.png` and rebuild
(`npm run site:build`); nothing else changes. The same file serves the English and French pages, so
capture in English first; the French pages say "Capture à venir" and use the same names. If you
capture the French UI too, add `-fr` files and point the French page at them.

Rules: PNG, 1280 px wide at most (crop to the relevant window), no personal data (blur Discord IDs, email
and real names; use a test or guild-mate-safe character), highlight the thing to press with a gold
rectangle or arrow. Game shots at the normal UI scale, no other addons' clutter.

## Install Guilded (`/guides/install/`)

| File (`site/assets/guides/`) | Window and state | Highlight |
|---|---|---|
| `install-curseforge-page.png` | Browser, the Guilded page on CurseForge (curseforge.com/wow/addons/guilded), Files list showing the WoW Forever file | The Download button of the Forever file |
| `install-addons-folder.png` | Windows Explorer, the Forever game folder open at `Interface\AddOns\Guilded` | `Guilded.toc` directly inside `Guilded` (address bar visible) |
| `install-ingame-addons-list.png` | WoW character select, AddOns list open | The Guilded line ticked (and Load out of date AddOns if shown) |
| `install-ingame-window.png` | In game, the Guilded window open after `/guilded` | The gold minimap coin and the window title |
| `install-store-listing.png` | Microsoft Store, the Guilded Companion page (apps.microsoft.com/detail/9N680XX3QFL9) | The Get / Install button |
| `install-smartscreen.png` | Windows SmartScreen on the direct installer, after pressing More info | The Run anyway button |
| `install-companion-first-launch.png` | Companion, Home page on a fresh profile ("Welcome to Guilded.") with the WoW/addon setup note showing | The Set up WoW and the addon button |

## Link your character (`/guides/link/`)

| File (`site/assets/guides/`) | Window and state | Highlight |
|---|---|---|
| `link-companion-link-everything.png` | Companion, Link everything page, not signed in yet | The Sign in with Discord button |
| `link-browser-connect.png` | Browser, the "Connect your companion" page on guilded.kcaron.top/me/companion with the server choice | The server choice and the Connect button (blur the URL's request id) |
| `link-ingame-reload.png` | WoW chat box with `/reload` typed, before pressing Enter | The typed command |
| `link-companion-linked.png` | Companion, Link everything page after linking: green check, "Everything is linked. Nothing more to do." and the Your characters table with ✓ Linked on at least two characters | The green check, the Linked column |
| `link-discord-confirmation.png` | Discord, the direct message from the bot naming the linked characters | The character names |
| `link-discord-character-pair.png` | Discord, the private reply to `/character pair` showing the `/guilded verify CODE` line (blur the code) | The `/guilded verify` line |
| `link-ingame-verify.png` | WoW chat after pasting `/guilded verify CODE` and pressing Enter, with the "Your Discord link code is saved" line | The confirmation line (blur the code) |

## Later (not used by a guide yet)

Item 20 also asks for feature shots for CurseForge and social media. Add rows here when the coordinator
picks them, and keep file names under `site/assets/guides/` only for guide shots.
