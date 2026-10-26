import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedBuilder, MessageFlags } from "discord.js";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), rename: vi.fn(), sync: vi.fn(), discord: vi.fn(), prices: vi.fn(), characters:vi.fn(), character:vi.fn(), member:vi.fn(), setCharacter:vi.fn(), backupPage:vi.fn(),pick:vi.fn(),addMember:vi.fn(),settings:vi.fn(),ensureMember:vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { raidCore: { findUniqueOrThrow: mocks.lookup },character:{findMany:mocks.characters,findFirst:mocks.character},member:{findFirst:mocks.member} } }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g" }), guildService: { getSettings: mocks.settings,ensureMember:mocks.ensureMember }
}));
vi.mock("../src/services/raid-core.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/services/raid-core.js")>(),
  createRaidCoreService: () => ({ byIdOrName: mocks.lookup, rename: mocks.rename, setCharacter:mocks.setCharacter, replaceBackupPage:mocks.backupPage,addMember:mocks.addMember }),
  coreRosterEmbed: () => new EmbedBuilder(), syncCoreRoster: mocks.sync
}));
vi.mock("../src/services/core-channels.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/services/core-channels.js")>(),
  coreChannelLanguage: async () => "en", renameCoreDiscord: mocks.discord
}));
vi.mock("../src/services/item-values.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/services/item-values.js")>(),
  createItemValueService: () => ({ setMany: mocks.prices }), priceDraft: async () => ({ text: "Sword = 100" })
}));
const { executeCore } = await import("../src/commands/core.js");
const { runCoreEditor } = await import("../src/commands/core-editor.js");
vi.mock('../src/commands/signup-character-picker.js',()=>({pickSignupCharacter:mocks.pick}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue({ id: "c", name: "Old Core", description: "" });
  mocks.rename.mockResolvedValue({ id: "c", name: "New Core" });
  mocks.prices.mockResolvedValue(1);
  mocks.sync.mockResolvedValue(true);
  mocks.settings.mockResolvedValue({});mocks.ensureMember.mockResolvedValue({id:'m'});
});
async function editor() {
  const handlers: Record<string, (event: never) => Promise<void>> = {};
  const command = {
    user: { id: "leader" }, guild: { id: "discord",members:{fetch:vi.fn().mockResolvedValue({displayName:'Player',user:{bot:false}})} },
    member: { permissions: { has: () => true } },
    deferReply: vi.fn(), reply: vi.fn(), editReply: vi.fn(),
    fetchReply: async () => ({ createMessageComponentCollector: () => ({ on: (event: string, handler: typeof handlers[string]) => { handlers[event] = handler; } }) })
  };
  await runCoreEditor(command as never, "g", "c");
  return { command, collect: handlers["collect"]! };
}
function modal(kind: string) {
  const submitted = {
    guild: { id: "discord" }, member: { permissions: { has: () => true } },
    deferred: false, replied: false,
    fields: { getTextInputValue: (key: string) => key === "prices" ? "Sword = 100" : "New Core" },
    deferUpdate: vi.fn(async () => { submitted.deferred = true; }), reply: vi.fn(), followUp: vi.fn()
  };
  const click = {
    guild: { id: "discord" }, member: { permissions: { has: () => true } },
    id: `click-${kind}`, customId: `coreedit:${kind}`, user: { id: "leader" }, isButton: () => true,
    showModal: vi.fn(), awaitModalSubmit: vi.fn<(options: {filter:(value:{user:{id:string};customId:string})=>boolean}) => Promise<typeof submitted>>().mockResolvedValue(submitted), reply: vi.fn(), followUp: vi.fn().mockResolvedValue(undefined)
  };
  return { submitted, click };
}

async function charactersEditor() {
  const characters=Array.from({length:26},(_,i)=>({id:`id-${i}`,name:'Ann',displayName:`Ann Family${i}`,realm:`Realm${i}`,className:'Mage',isMain:i===0}));
  mocks.lookup.mockResolvedValue({id:'c',name:'Core',members:[{memberId:'m',member:{displayName:'Owner'},character:characters[0],characterId:'id-0',backups:[]}]});
  mocks.characters.mockImplementation(async({skip=0,take=25})=>characters.slice(skip,skip+take));
  mocks.character.mockImplementation(async({where})=>characters.find(c=>c.id===where.id)??null);
  mocks.member.mockResolvedValue({id:'m'});mocks.backupPage.mockResolvedValue(0);
  const {collect}=await editor();let nested:((i:never)=>Promise<void>)|undefined;
  const {click}=modal('characters');
  Object.assign(click,{fetchReply:async()=>({createMessageComponentCollector:()=>({on:(name:string,fn:typeof nested)=>{if(name==='collect')nested=fn;}})})});
  await collect(click as never);
  function event(customId:string,values:string[]=[]) {
    const {click}=modal('unused');
    return {...click,customId,values,isUserSelectMenu:()=>customId==='corechar:player',isStringSelectMenu:()=>customId.startsWith('corechar:main:')||customId.startsWith('corechar:backups:'),isButton:()=>customId.includes(':next:')||customId.includes(':previous:'),deferUpdate:vi.fn(),editReply:vi.fn()};
  }
  const player=event('corechar:player',['owner']);await nested!(player as never);
  return {collect:nested!,event,player};
}

describe('core character picker',()=>{
  it('shows full names, pages beyond 24 characters, and limits backup edits to the current page',async()=>{
    const {collect,event,player}=await charactersEditor();
    const menu=player.editReply.mock.calls[0]![0].components[1].toJSON().components[0];
    expect(menu.options).toHaveLength(25);expect(menu.options[1].label).toContain('Ann Family0');
    const next=event('corechar:next:m:0');await collect(next as never);
    expect(next.editReply.mock.calls[0]![0].components[1].toJSON().components[0].options.map((o:{value:string})=>o.value)).toEqual(['__none__','id-24','id-25']);
    await collect(event('corechar:backups:m:0',[]) as never);expect(mocks.backupPage).not.toHaveBeenCalled();expect(mocks.sync).not.toHaveBeenCalled();
    await collect(event('corechar:backups:m:1',[]) as never);
    expect(mocks.backupPage).toHaveBeenCalledWith('g','c','m',['id-24','id-25'],[],'DPS');
  });
  it('passes an exact character ID and refuses a deleted selection instead of clearing the current character',async()=>{
    const {collect,event}=await charactersEditor();
    await collect(event('corechar:main:m:0',['id-1']) as never);
    expect(mocks.setCharacter).toHaveBeenCalledWith('g','c','m','id-1');
    mocks.setCharacter.mockClear();mocks.character.mockResolvedValue(null);
    const stale=event('corechar:main:m:0',['id-2']);await collect(stale as never);
    expect(mocks.setCharacter).not.toHaveBeenCalled();expect(stale.followUp).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('no longer linked')}));
  });
  it('refuses character edits after leadership access is revoked',async()=>{
    const {collect,event}=await charactersEditor();const denied=event('corechar:main:m:0',['id-1']);
    Object.assign(denied,{member:{permissions:{has:()=>false},roles:{cache:[]}}});
    await collect(denied as never);expect(mocks.setCharacter).not.toHaveBeenCalled();expect(denied.reply).toHaveBeenCalled();
  });
});

describe("core interaction response timing", () => {
  it('stops the entire add batch when authority is lost in a nested character picker',async()=>{
    const {collect,command}=await editor();mocks.settings.mockResolvedValue({characterSignups:true});
    mocks.pick.mockImplementation(async(_i,_g,_m,authorize)=>{const {click}=modal('unused');Object.assign(click,{member:{permissions:{has:()=>false},roles:{cache:[]}}});expect(await authorize(click)).toBe(false);return null;});
    const {click}=modal('add');Object.assign(click,{isButton:()=>false,isUserSelectMenu:()=>true,values:['first','second'],deferUpdate:vi.fn()});
    await collect(click as never);expect(mocks.addMember).not.toHaveBeenCalled();expect(command.guild.members.fetch).toHaveBeenCalledTimes(1);expect(mocks.pick).toHaveBeenCalledTimes(1);
  });
  it.each(['rename','prices'])('accepts only the modal belonging to this %s click',async kind=>{
    const {collect}=await editor();const {click}=modal(kind);await collect(click as never);
    const modalId=click.showModal.mock.calls[0]![0].toJSON().custom_id;
    const filter=click.awaitModalSubmit.mock.calls[0]![0].filter;
    expect(filter({user:{id:'leader'},customId:modalId})).toBe(true);
    expect(filter({user:{id:'leader'},customId:`coreedit:${kind}:another-click`})).toBe(false);
    expect(filter({user:{id:'another'},customId:modalId})).toBe(false);
  });
  it.each(["rename", "prices"])("refuses a submitted %s after leadership access is lost", async kind => {
    const { collect } = await editor(); const { submitted, click } = modal(kind);
    Object.assign(submitted, { member: { permissions: { has: () => false }, roles: { cache: [] } } });
    await collect(click as never);
    expect(submitted.reply).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('Current Raid Leader')}));
    expect(mocks.rename).not.toHaveBeenCalled();expect(mocks.prices).not.toHaveBeenCalled();expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("refuses an old editor button after leadership access is lost", async () => {
    const { collect } = await editor(); const { click } = modal('rename');
    Object.assign(click, { member: { permissions: { has: () => false }, roles: { cache: [] } } });
    await collect(click as never);expect(click.showModal).not.toHaveBeenCalled();expect(click.reply).toHaveBeenCalled();
  });
  it("acknowledges slash renaming before core lookup, database writes or channel renaming", async () => {
    const command = {
      guild: { id: "discord" }, member: { permissions: { has: () => true } },
      options: { getSubcommand: () => "rename", getString: () => "New Core" },
      deferReply: vi.fn(), reply: vi.fn(), editReply: vi.fn()
    };
    await executeCore(command as never);
    expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(command.deferReply.mock.invocationCallOrder[0]!).toBeLessThan(mocks.lookup.mock.invocationCallOrder[0]!);
    expect(mocks.discord).toHaveBeenCalled();
    expect(command.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("New Core") });
    expect(command.reply).not.toHaveBeenCalled();
  });
  it("acknowledges opening the editor before its database reads", async () => {
    const { command } = await editor();
    expect(command.deferReply.mock.invocationCallOrder[0]!).toBeLessThan(mocks.lookup.mock.invocationCallOrder[0]!);
    expect(command.reply).not.toHaveBeenCalled();
    expect(command.editReply).toHaveBeenCalled();
  });
  it.each(["rename", "prices"])("acknowledges submitted %s before writes and refresh", async kind => {
    const { collect, command } = await editor();
    const { submitted, click } = modal(kind);
    await collect(click as never);
    const save = kind === "rename" ? mocks.rename : mocks.prices;
    expect(submitted.deferUpdate.mock.invocationCallOrder[0]!).toBeLessThan(save.mock.invocationCallOrder[0]!);
    expect(command.editReply).toHaveBeenCalledTimes(2);
    expect(submitted.reply).not.toHaveBeenCalled();
    expect(submitted.followUp).not.toHaveBeenCalled();
  });
  it.each(["rename", "prices"])("reports %s failure after deferring without replying twice", async kind => {
    const { collect } = await editor();
    const { submitted, click } = modal(kind);
    (kind === "rename" ? mocks.rename : mocks.prices).mockRejectedValue(new Error("Database temporarily unavailable"));
    await collect(click as never);
    expect(submitted.followUp).toHaveBeenCalledWith({ content: "Database temporarily unavailable", flags: MessageFlags.Ephemeral });
    expect(submitted.reply).not.toHaveBeenCalled();
    expect(click.reply).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
