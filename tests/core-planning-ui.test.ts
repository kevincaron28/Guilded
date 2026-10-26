import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ core: vi.fn(), settings: vi.fn(), update: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { raidCore: { findFirstOrThrow: mocks.core, update: mocks.update }, guildSettings: { findUnique: mocks.settings } } }));
function access() { return { guild: { id: "discord" }, member: { permissions: { has: () => true } }, deferReply: vi.fn(), reply: vi.fn(), followUp: vi.fn() }; }
import { editCoreComposition, editCoreSchedule } from "../src/commands/core-planning.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.core.mockResolvedValue({ id: "core", name: "December launch", weeklySchedule: null, weeklyHorizonDays: 6 });
  mocks.settings.mockResolvedValue({ timezone: "America/Toronto" });
});

describe("core planning forms", () => {
  it('refuses a composition submitted after leadership is revoked', async()=>{
    const submitted={...access(),member:{permissions:{has:()=>false},roles:{cache:[]}},fields:{getTextInputValue:()=>"1"},editReply:vi.fn()};
    const choice={...access(),isStringSelectMenu:()=>true,values:['20'],showModal:vi.fn(),awaitModalSubmit:async()=>submitted};
    const i={...access(),id:'click',user:{id:'leader'},editReply:vi.fn(),fetchReply:async()=>({awaitMessageComponent:async()=>choice})};
    expect(await editCoreComposition(i as never,'guild','core')).toBeNull();expect(mocks.update).not.toHaveBeenCalled();expect(submitted.reply).toHaveBeenCalled();
  });
  it('refuses to stop a schedule after leadership is revoked',async()=>{
    const choice={...access(),member:{permissions:{has:()=>false},roles:{cache:[]}},isStringSelectMenu:()=>true,values:['stop'],deferUpdate:vi.fn()};
    const i={...access(),id:'click',user:{id:'leader'},editReply:vi.fn(),fetchReply:async()=>({awaitMessageComponent:async()=>choice})};
    expect(await editCoreSchedule(i as never,'guild','core')).toBeNull();expect(choice.reply).toHaveBeenCalled();expect(choice.deferUpdate).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rechecks authority on the final schedule confirmation',async()=>{
    const confirm={...access(),member:{permissions:{has:()=>false},roles:{cache:[]}},deferUpdate:vi.fn()};
    const submitted={...access(),fields:{getTextInputValue:(key:string)=>({time:'20:00',start:'2026-12-04',days:'28',custom:''})[key]},editReply:vi.fn(),fetchReply:async()=>({awaitMessageComponent:async()=>confirm})};
    const choice={...access(),isStringSelectMenu:()=>true,values:['5'],showModal:vi.fn(),awaitModalSubmit:async()=>submitted};
    const i={...access(),id:'click',user:{id:'leader'},editReply:vi.fn(),fetchReply:async()=>({awaitMessageComponent:async()=>choice})};
    expect(await editCoreSchedule(i as never,'guild','core')).toBeNull();expect(confirm.reply).toHaveBeenCalled();expect(confirm.deferUpdate).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
  });
  it("saves a validated composition scoped to the current guild", async () => {
    const submitted = { ...access(), fields: { getTextInputValue: (key: string) => ({ size: "20", tanks: "2", healers: "4", dps: "14" })[key] }, deferReply: vi.fn(), editReply: vi.fn() };
    const choice = { ...access(), isStringSelectMenu: () => true, values: ["20"], showModal: vi.fn(async modal => modal.toJSON()), awaitModalSubmit: vi.fn(async () => submitted) };
    const i = { ...access(), id: "click", user: { id: "leader" }, deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => choice })) };
    expect(await editCoreComposition(i as never, "guild", "core")).toContain("20 joueurs");
    expect(mocks.core).toHaveBeenCalledWith({ where: { id: "core", guildId: "guild" } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "core" }, data: { raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14 } });
    expect(choice.showModal.mock.calls[0]![0].toJSON().components).toHaveLength(3);
    expect(i.editReply.mock.calls[0]![0].components[0].toJSON().components[0].options.map((option: { value: string }) => option.value)).toEqual(["10", "20", "25", "30", "40", "preset:barrow", "preset:hyjal", "preset:onyxia", "preset:group10", "preset:group20", "preset:group25", "preset:group30", "preset:group40"]);
  });
  it("prefills a chosen preset even at the same core size, then saves the officer's edits", async () => {
    mocks.core.mockResolvedValue({ id: "core", raidSize: 10, tankLimit: 1, healerLimit: 3, dpsLimit: 6 });
    const submitted = { ...access(), fields: { getTextInputValue: (key: string) => ({ tanks: "1", healers: "3", dps: "6" })[key] }, deferReply: vi.fn(), editReply: vi.fn() };
    const choice = { ...access(), isStringSelectMenu: () => true, values: ["preset:barrow"], showModal: vi.fn(async modal => modal.toJSON()), awaitModalSubmit: vi.fn(async () => submitted) };
    const i = { ...access(), id: "preset", user: { id: "leader" }, deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => choice })) };
    const result = await editCoreComposition(i as never, "guild", "core");
    const fields = choice.showModal.mock.calls[0]![0].toJSON().components.map((row: { components: { value: string }[] }) => row.components[0]!.value);
    expect(fields).toEqual(["2", "2", "6"]);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "core" }, data: { raidSize: 10, tankLimit: 1, healerLimit: 3, dpsLimit: 6 } });
    expect(result).toContain("raids publiés restent inchangés");
  });
  it("does not save a schedule unless the officer confirms its dated preview", async () => {
    const submitted = { ...access(), fields: { getTextInputValue: (key: string) => ({ time: "20:00", start: "2026-12-04", days: "28", custom: "" })[key] },
      reply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => { throw new Error("expired"); } })) };
    const choice = { ...access(), isStringSelectMenu: () => true, values: ["5"], showModal: vi.fn(async modal => modal.toJSON()), awaitModalSubmit: vi.fn(async () => submitted) };
    const i = { ...access(), id: "click", user: { id: "leader" }, reply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => choice })) };
    expect(await editCoreSchedule(i as never, "guild", "core")).toBeNull();
    expect(submitted.editReply.mock.calls[0]![0].content).toContain("2026-12-04");
    expect(submitted.editReply.mock.calls[0]![0].content).toContain("America/Toronto");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(choice.showModal.mock.calls[0]![0].toJSON().components).toHaveLength(4);
  });
});
