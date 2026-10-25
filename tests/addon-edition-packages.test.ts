import { describe,it,expect } from "vitest";
import { unzipSync } from "fflate";
import { packageEdition } from "../scripts/build-addon-editions.mjs";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";

describe("edition release archives",()=>{
  it.each(GAME_EDITIONS)("packages both addons for %s without guild records",edition=>{
    for(const addon of ["Guilded","GuildedDungeons"]){
      const built=packageEdition(addon,edition);
      const files=unzipSync(built.packed), decode=(path:string)=>new TextDecoder().decode(files[path]);
      expect(decode(`${addon}/${addon}.toc`)).toContain(`## X-Guilded-Edition: ${edition}`);
      expect(decode(`${addon}/${addon}.toc`)).toContain(`## Interface: ${built.interface}`);
      if(addon==="Guilded") expect(decode("Guilded/Standings.lua")).toContain("players = {}");
      expect(Object.keys(files).some(name=>name.includes("SavedVariables"))).toBe(false);
    }
  });
  it("rejects a manifest aimed at another client family",()=>{
    expect(()=>packageEdition("Guilded","retail",16001)).toThrow();
  });
});
