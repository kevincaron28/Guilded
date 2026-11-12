// The name the Microsoft Store lists the companion under (13 November 2026). Store policy 10.1.1.1
// refused "Guilded Companion" (guilded.gg is an unrelated chat service), so only the Store listing and
// the MSIX display name use this; the website installer, shortcuts, window, tray, settings folders and
// every identifier keep "Guilded Companion". It must equal the name reserved in Partner Center and
// contain no other product's title ("Guilded", "WoW", "World of Warcraft", "Discord").
// Fallbacks if the first choice is taken: "Guild Data Sync", "Guild Sync Desktop".
module.exports = { STORE_DISPLAY_NAME: "Guild Sync Companion" };
