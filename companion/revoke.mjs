import { credentialHeaders, requestJson, checkUrl } from "./request.mjs";
import { savedProfiles } from "./profiles.mjs";

export async function revokeSavedConnections(config) {
  const seen = new Set();
  let failed = 0, revoked = 0;
  for (const profile of Object.values(savedProfiles(config))) {
    if (!profile.companionCredential) continue;
    try {
      const url = checkUrl(new URL("/api/v1/companion/logout", profile.uploadUrl));
      const key = `${url.origin}:${profile.companionCredential}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { response } = await requestJson(url, {
        method: "POST", headers: { ...credentialHeaders(profile), "content-type": "application/json" },
        body: JSON.stringify({ guildDiscordId: profile.guildDiscordId || "" })
      }, undefined, 5000);
      if (!response.ok) failed++; else revoked++;
    } catch { failed++; }
  }
  return { failed, revoked };
}
