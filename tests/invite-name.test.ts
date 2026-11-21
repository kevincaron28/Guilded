import { describe, expect, it } from "vitest";
import { extractInviteName } from "../src/services/invite-name.js";

const name = (text: string) => { const r = extractInviteName(text); return r.kind === "name" ? r.displayName : r.kind === "first" ? `first:${r.first}` : "none"; };

describe("a name inside a sentence (English)", () => {
  it.each([
    ["hello i would like to join the guilde my name is blah blah", "Blah Blah"],
    ["Hi! My name is Lebowski Holyroller, can I get an invite please?", "Lebowski Holyroller"],
    ["hey, I'm Drakka Whitefang and I'd love to join", "Drakka Whitefang"],
    ["IGN Amy Archer", "Amy Archer"],
    ["ign: bob brewer thanks", "Bob Brewer"],
    ["my char is Cid Cole, level 12 mage", "Cid Cole"],
    ["char Dee Dale pls", "Dee Dale"],
    ["please invite Eve Ellis", "Eve Ellis"],
    ["Hello everyone, looking to join the guild. Zed Zealot", "Zed Zealot"],
    ["hi 😀 my name is anna smith-jones 🙏", "Anna Smith-Jones"]
  ])("%s", (text, expected) => expect(name(text)).toBe(expected));
});

describe("a name inside a sentence (French)", () => {
  it.each([
    ["salut je voudrais rejoindre la guilde, je m'appelle Éloïse Brûlé", "Éloïse Brûlé"],
    ["Bonjour, mon nom est Jean Tremblay merci", "Jean Tremblay"],
    ["mon perso c'est Marc Lavoie svp", "Marc Lavoie"],
    ["mon perso est lucie gagnon", "Lucie Gagnon"],
    ["pseudo Pierre Roy", "Pierre Roy"],
    ["bonsoir! c'est Sophie Bouchard, je cherche une guilde", "Sophie Bouchard"],
    ["Salut Nadia Côté", "Nadia Côté"],
    ["invite Hugo Lemieux stp", "Hugo Lemieux"]
  ])("%s", (text, expected) => expect(name(text)).toBe(expected));
});

describe("a first name alone needs the last name", () => {
  it.each([
    ["hello my name is blah", "first:Blah"],
    ["salut je m'appelle Éloïse", "first:Éloïse"],
    ["hi I'm Drakka, can I join?", "first:Drakka"],
    ["IGN Amy", "first:Amy"]
  ])("%s", (text, expected) => expect(name(text)).toBe(expected));
});

describe("no name at all", () => {
  it.each([
    "can I join the guild?",
    "hello",
    "salut, je voudrais rejoindre la guilde svp",
    "i'm looking to join a guild",
    "merci beaucoup!",
    "😀😀",
    ""
  ])("%j", (text) => expect(name(text)).toBe("none"));
  it("never reads a name from a mention or a link", () => {
    expect(name("<@123456789012345678> https://example.com/Foo-Bar")).toBe("none");
  });
});

describe("what comes back", () => {
  it("gives a key for the queue: lowercase and accents kept", () => {
    expect(extractInviteName("je m'appelle Éloïse Brûlé")).toMatchObject({ kind: "name", displayName: "Éloïse Brûlé", nameKey: "éloïse brûlé" });
  });
});
