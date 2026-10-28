import { afterEach, expect, it, vi } from "vitest";
import { revokeCompanionCredential } from "../src/services/companion-revoke.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";
import { revokeSavedConnections } from "../companion/revoke.mjs";
afterEach(() => vi.unstubAllGlobals());
it("revokes only the presented token in either credential store without membership gates", async () => {
  const db = { companionCredential: { updateMany: vi.fn(async () => ({ count: 1 })) }, webCompanionCredential: { updateMany: vi.fn(async () => ({ count: 0 })) } };
  expect(await revokeCompanionCredential(db as unknown as PrismaClient, "x".repeat(43))).toBe(true);
  for (const table of Object.values(db)) expect(table.updateMany).toHaveBeenCalledWith({ where: { tokenHash: hashCompanionSecret("x".repeat(43)), revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  expect(await revokeCompanionCredential(db as unknown as PrismaClient, "bad")).toBe(false);
  expect(db.companionCredential.updateMany).toHaveBeenCalledOnce();
});
it("revokes all distinct profiles and reports offline failures without leaking secrets", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const first = { uploadUrl: "https://bot.example/api/v1/addon-imports", companionCredential: "a".repeat(43), guildDiscordId: "1" };
  const result = await revokeSavedConnections({ ...first, profiles: { same: first, personal: { ...first, companionCredential: "b".repeat(43), personal: true, guildDiscordId: "" } } });
  expect(result).toEqual({ failed: 1, revoked: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[0]![0])).toBe("https://bot.example/api/v1/companion/logout");
  expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error", headers: { "x-companion-credential": first.companionCredential } });
});
it("refuses insecure revocation destinations before sending a credential", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await revokeSavedConnections({ uploadUrl: "http://remote.example", companionCredential: "x".repeat(43) })).toEqual({ failed: 1, revoked: 0 });
  expect(fetch).not.toHaveBeenCalled();
});
