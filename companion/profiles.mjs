// Each connection owns its credential and file paths. Legacy settings become
// the default profile on first use, without requiring another sign-in.
export function savedProfiles(config) {
  const { profiles = {}, activeProfile = "default", ...active } = config;
  return { ...profiles, [activeProfile]: { ...active, syncEnabled: active.syncEnabled !== false, pairingCode: "" } };
}
// A connection nobody set up: no bot address and no sign-in.
export const isBlankProfile = (p) => !p?.uploadUrl && !p?.companionCredential && !p?.poeEnabled;

// Startup clean-up: drop saved blank connections (never the active one) once another is set up.
export function pruneBlankProfiles(config) {
  const { profiles, activeProfile = "default" } = config;
  if (!profiles || typeof profiles !== "object") return { config, changed: false };
  const all = savedProfiles(config);
  if (!Object.values(all).some((p) => !isBlankProfile(p))) return { config, changed: false };
  const kept = Object.fromEntries(Object.entries(profiles).filter(([id, p]) => id === activeProfile || !isBlankProfile(p)));
  return Object.keys(kept).length === Object.keys(profiles).length ? { config, changed: false } : { config: { ...config, profiles: kept }, changed: true };
}
export function profileChoices(config) {
  return Object.entries(savedProfiles(config)).map(([id, p]) => ({ id, name: p.profileName || p.wowGuildName || (id === "default" ? "Original connection" : id), defaultName: id === "default" && !p.profileName && !p.wowGuildName, gameEdition: p.gameEdition || "" }));
}
export function switchProfile(config, id) {
  const profiles = savedProfiles(config);
  if (!Object.hasOwn(profiles, id)) throw new Error("Connection profile not found.");
  return { ...profiles[id], profiles, activeProfile: id };
}
export function addProfile(config, name) {
  if (Object.keys(savedProfiles(config)).length >= 20) throw new Error("Up to 20 connection profiles are supported.");
  const profileName = String(name || "").trim().slice(0, 80);
  if (!profileName) throw new Error("Name this connection (for example Retail guild).");
  const profiles = savedProfiles(config);
  let index = 1;
  while (Object.hasOwn(profiles, `connection-${index}`)) index++;
  const id = `connection-${index}`;
  profiles[id] = { profileName, wowEnabled: true, poeEnabled: false, personal: false, uploadUrl: config.uploadUrl || "", guildDiscordId: "", companionCredential: "", pairingCode: "", watchFile: "", wowGuild: "", realm: "", standingsIntervalMinutes: 2 };
  return switchProfile({ ...config, profiles }, id);
}
