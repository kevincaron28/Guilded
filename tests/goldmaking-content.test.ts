import { describe, expect, it } from "vitest";
import {
  FORUMS, TEXT_CHANNELS, START_CHANNEL_NAMES, FORUM_NAMES, TEMPLATE_THREAD_TITLE, templatePosts
} from "../scripts/goldmaking-content.js";

describe("Goldmaking section definition", () => {
  it("defines the six start channels and seven forums in order", () => {
    expect(TEXT_CHANNELS.map(c => c.name)).toEqual([...START_CHANNEL_NAMES]);
    expect(FORUMS.map(f => f.name)).toEqual([...FORUM_NAMES]);
    expect(START_CHANNEL_NAMES).toHaveLength(6);
    expect(FORUM_NAMES).toHaveLength(7);
  });

  it("respects Discord's forum tag limits (20 tags, 20 characters, unique)", () => {
    for (const forum of FORUMS) {
      expect(forum.tags.length).toBeLessThanOrEqual(20);
      expect(new Set(forum.tags).size).toBe(forum.tags.length);
      for (const tag of forum.tags) expect(tag.length).toBeLessThanOrEqual(20);
      expect(forum.topic.length).toBeLessThanOrEqual(4096);
    }
  });

  it("keeps channel topics, post titles and embeds inside Discord limits", () => {
    for (const channel of TEXT_CHANNELS) {
      expect(channel.topic.length).toBeLessThanOrEqual(1024);
      const keys = channel.posts.map(p => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const post of channel.posts) {
        expect(post.title.length).toBeLessThanOrEqual(256);
        expect(post.body.length).toBeLessThanOrEqual(3900);
      }
    }
  });

  it("keeps the forum starter template within message limits and complete", () => {
    expect(TEMPLATE_THREAD_TITLE.length).toBeLessThanOrEqual(100);
    for (const forum of FORUMS) {
      const { intro, template } = templatePosts(forum);
      expect(intro.length).toBeLessThanOrEqual(4000);
      expect(template.length).toBeLessThanOrEqual(2000);
      for (const section of ["Prérequis", "Emplacement", "Quoi farmer", "Pourquoi ça marche", "Rentabilité estimée", "Stratégie de vente", "Conseils", "Source et dernière vérification"]) {
        expect(template).toContain(section);
      }
    }
  });

  it("only links to channels that the section defines", () => {
    const known = new Set<string>([...START_CHANNEL_NAMES, ...FORUM_NAMES]);
    for (const channel of TEXT_CHANNELS) for (const post of channel.posts) {
      for (const m of post.body.matchAll(/\{\{ch:([a-z-]+)\}\}/g)) expect(known.has(m[1]!)).toBe(true);
    }
  });

  it("does not state invented gold-per-hour figures", () => {
    const all = TEXT_CHANNELS.flatMap(c => c.posts.map(p => p.body)).join("\n");
    expect(all).not.toMatch(/\b\d+\s*(po|pc|g|gold|or)\s*(\/|par)\s*(h|heure)/i);
  });
});
