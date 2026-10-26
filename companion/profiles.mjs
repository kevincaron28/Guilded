// Each connection owns its credential and file paths. Legacy settings become
// the default profile on first use, without requiring another sign-in.
export function savedProfiles(config) {
  const { profiles = {}, activeProfile = "default", ...active } = config;
  return { ...profiles, [activeProfile]: { ...active, pairingCode: "" } };
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
  const profileName = String(name || "").trim().slice(0, 80);
  if (!profileName) throw new Error("Name this connection (for example Retail guild).");
  const profiles = savedProfiles(config);
  let index = 1;
  while (Object.hasOwn(profiles, `connection-${index}`)) index++;
  const id = `connection-${index}`;
  profiles[id] = { profileName, wowEnabled: true, poeEnabled: false, personal: false, uploadUrl: config.uploadUrl || "", guildDiscordId: "", companionCredential: "", pairingCode: "", watchFile: "", wowGuild: "", realm: "", standingsIntervalMinutes: 2 };
  return switchProfile({ ...config, profiles }, id);
}
