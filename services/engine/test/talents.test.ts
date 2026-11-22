import { describe, expect, it } from "vitest";
import { applyGameTalents, buildGameTalents, HERO_FILES_URL, talentSlots, toTalentConstants, toTree } from "../src/data/talents";
import type { Snapshot } from "../src/engine/types";
import { SVEN } from "./skill-build-fixture";

// Anti-Mage in 7.42, as the game files list him. Lycan-style: Ability17 written before Ability16.
const NPC = "npc_dota_hero_antimage";
const KEYS = [
  "special_bonus_unique_antimage_counterspell_reflect_duration",
  "special_bonus_unique_antimage_mana_break_damage",
  "special_bonus_unique_antimage_5",
  "special_bonus_unique_antimage_4",
  "special_bonus_unique_antimage_3",
  "special_bonus_unique_antimage_8",
  "special_bonus_unique_antimage",
  "special_bonus_unique_antimage_2",
];
const NAMES = [
  "+25% Counterspell Reflected Spell Debuff Duration",
  "+10% Mana Break Mana Burned As Damage",
  "+9%/18% Persecutor Min/Max Movement Slow",
  "+10% Counterspell Magic Resistance",
  "+125 Blink Cast Range",
  "+0.8s Mana Void Stun",
  "-1s Blink Cooldown",
  "-50s Mana Void Cooldown",
];
const IDS = [1935, 1936, 6800, 6799, 6606, 735, 6012, 6353];
const FILE = `"DOTAHeroes"
{
\t// HERO: Antimage
\t"${NPC}"
\t{
\t\t"Ability1"\t\t"antimage_mana_break"
${KEYS.slice(0, 6).map((k, i) => `\t\t"Ability${10 + i}"\t\t"${k}" // a comment`).join("\n")}
\t\t"Ability17"\t\t"${KEYS[7]}"
\t\t"Ability16"\t\t"${KEYS[6]}"
\t\t"Ability25"\t\t"special_bonus_attributes"
\t\t"AbilityDraftAbilities"
\t\t{
\t\t\t"Ability10"\t"special_bonus_nested"
\t\t}
\t\t"Facets"\t{
\t\t\t"Ability11"\t"special_bonus_facet"
\t\t}
\t}
\t"npc_dota_hero_other"
\t{
\t\t"Ability10"\t\t"special_bonus_other"
\t}
}`;

const constants = () =>
  toTalentConstants(
    { 1: { id: 1, name: NPC }, 2: { id: 2, name: "npc_dota_hero_new" } },
    {
      [NPC]: { talents: [...KEYS.map((name, i) => ({ name, level: Math.floor(i / 2) + 1 }))] },
      npc_dota_hero_new: { talents: [{ name: "special_bonus_new", level: 1 }] },
    },
    Object.fromEntries(KEYS.map((k, i) => [k, { dname: i === 0 ? " +25%% Counterspell  Reflected Spell Debuff Duration " : NAMES[i] }])),
    { ...Object.fromEntries(KEYS.map((k, i) => [String(IDS[i]), k])), "3060,1617": "templar_assassin_hidden_gates" },
  );

describe("game talents", () => {
  it("reads the hero's own talents by slot number, not line order or nested blocks", () => {
    expect(talentSlots(FILE, NPC)).toEqual(KEYS);
    expect(talentSlots(FILE, "npc_dota_hero_other")).toEqual(["special_bonus_other"]);
    expect(talentSlots(FILE, "npc_dota_hero_missing")).toEqual([]);
  });

  it("reads OpenDota's constants, tidying names and taking the first of several ids", () => {
    const c = constants();
    expect(c.heroes.get(1)).toBe(NPC);
    expect(c.names.get(KEYS[0]!)).toBe(NAMES[0]);
    expect(c.ids.get("templar_assassin_hidden_gates")).toBe(3060);
    expect(() => toTalentConstants([], {}, {}, {})).toThrow("not objects");
  });

  it("puts the second talent of each pair on the left, as the game does", () => {
    const built = toTree(KEYS, constants());
    if (!("tree" in built)) throw new Error(built.problem);
    expect(built.tree.map((pair) => pair.map((t) => t.name))).toEqual([
      [NAMES[1], NAMES[0]],
      [NAMES[3], NAMES[2]],
      [NAMES[5], NAMES[4]],
      // In game at 25: "-50s Mana Void Cooldown" left, "-1s Blink Cooldown" right.
      ["-50s Mana Void Cooldown", "-1s Blink Cooldown"],
    ]);
    expect(built.tree[3]?.map((t) => t.id)).toEqual([6353, 6012]);
    expect(toTree(KEYS.slice(1), constants())).toEqual({ problem: "7 talents" });
    expect(toTree([...KEYS.slice(1), "special_bonus_unknown"], constants())).toEqual({ problem: "no id for special_bonus_unknown" });
  });

  it("takes sides from the hero file and falls back to OpenDota's order without it", async () => {
    const urls: string[] = [];
    const fromFile = await buildGameTalents(constants(), (url) => (urls.push(url), Promise.resolve(FILE)));
    expect(urls[0]).toBe(`${HERO_FILES_URL}${NPC}.txt`);
    expect(fromFile.fromFiles).toBe(1);
    expect(fromFile.trees[1]?.[3]?.map((t) => t.id)).toEqual([6353, 6012]);
    // The new hero has one talent: left out, with a note.
    expect(fromFile.trees[2]).toBeUndefined();
    expect(fromFile.notes).toContain("npc_dota_hero_new: left as it was, 1 talents");

    // OpenDota lists Ability17 first here; with the file down, its order is used.
    const swapped = constants();
    swapped.talents.set(NPC, [...KEYS.slice(0, 6), KEYS[7]!, KEYS[6]!]);
    const down = await buildGameTalents(swapped, () => Promise.reject(new Error("HTTP 503")));
    expect(down.fromFiles).toBe(0);
    expect(down.notes[0]).toBe(`${NPC}: file failed (HTTP 503), OpenDota's order`);
    expect(down.trees[1]?.[3]?.map((t) => t.id)).toEqual([6012, 6353]);
  });

  it("puts the trees on the snapshot's heroes and counts the changed ones", () => {
    const tree = [[{ id: 1, name: "+1 Armor" }, { id: 2, name: "+2 Armor" }]];
    const snapshot = { heroAbilities: { 18: { ...SVEN }, 19: { ...SVEN } } } as unknown as Snapshot; // Only heroAbilities is read.
    expect(applyGameTalents(snapshot, { 18: tree, 19: SVEN.talents, 20: tree })).toBe(1);
    expect(snapshot.heroAbilities?.[18]).toMatchObject({ talents: tree, talentsFrom: "game" });
    expect(snapshot.heroAbilities?.[19]?.talentsFrom).toBe("game");
    expect(snapshot.heroAbilities?.[20]).toBeUndefined();
  });
});
