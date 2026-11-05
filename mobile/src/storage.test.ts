import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ bag: new Map<string, string>(), renew: vi.fn(), failDelete: false }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: async () => new Uint8Array(32).fill(31) }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => fixture.bag.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { fixture.bag.set(key, value); },
  deleteItemAsync: async (key: string) => { if (fixture.failDelete) throw new Error("locked"); fixture.bag.delete(key); }
}));
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, GuildedClient: class { renew(next: string) { return fixture.renew(next); } logout() { return Promise.resolve(); } } };
});
import { clearSession, readSession, renewSession, saveSession, type Session } from "./storage";
const session: Session = { apiOrigin: "https://guilded.kcaron.top", companionCredential: "a".repeat(43), guildDiscordId: "123456", guildName: "Northwind", gameEdition: "retail", personal: false };
beforeEach(async () => { fixture.failDelete = false; fixture.renew.mockReset(); await clearSession(); fixture.bag.clear(); });
describe("mobile credential persistence", () => {
  it("round trips guild metadata and falls back to a tombstone if deletion fails", async () => {
    await saveSession(session);
    expect(await readSession()).toEqual(session);
    fixture.failDelete = true;
    await clearSession();
    expect(await readSession()).toBeNull();
  });
  it("retries the identical write-ahead credential after a lost renewal response", async () => {
    await saveSession(session);
    fixture.renew.mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce(undefined);
    await expect(renewSession(session)).rejects.toThrow(/lost/);
    const pending = await readSession();
    expect(pending?.pendingCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const next = await renewSession(session);
    expect(fixture.renew.mock.calls[0]?.[0]).toBe(fixture.renew.mock.calls[1]?.[0]);
    expect(next.companionCredential).toBe(pending?.pendingCredential);
    expect((await readSession())?.pendingCredential).toBeUndefined();
  });
  it("does not restore a session when logout happens during renewal", async () => {
    await saveSession(session);
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => fixture.renew.mockImplementationOnce(() => { resolve(); return new Promise<void>((done) => { finish = done; }); }));
    const pending = renewSession(session);
    await entered;
    await clearSession();
    finish();
    await expect(pending).rejects.toThrow(/changed/);
    expect(await readSession()).toBeNull();
  });
});
