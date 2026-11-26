import { describe, expect, it } from "vitest";
import { applyGameTalents, buildGameTalents, HERO_FILES_URL, talentSlots, toTalentConstants, toTree, withGameTexts } from "../src/data/talents";
import { GAME_FILES_URL } from "../src/data/talent-texts";
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
      [NPC]: {
        abilities: ["antimage_mana_break", "antimage_persectur", "generic_hidden"],
        talents: [...KEYS.map((name, i) => ({ name, level: Math.floor(i / 2) + 1 }))],
      },
      npc_dota_hero_new: { talents: [{ name: "special_bonus_new", level: 1 }] },
    },
    {
      ...Object.fromEntries(KEYS.map((k, i) => [k, { dname: i === 0 ? " +25%% Counterspell  Reflected Spell Debuff Duration " : NAMES[i] }])),
      antimage_mana_break: { dname: "Mana Break" },
      antimage_persectur: { dname: "Persecutor", is_innate: true },
    },
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
    // Only innate abilities, by their names; a hero without one has no entry.
    expect(c.innate.get(NPC)).toEqual(["Persecutor"]);
    expect(c.innate.has("npc_dota_hero_new")).toBe(false);
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
    expect(fromFile.innate).toEqual({ 1: ["Persecutor"] });
    // The new hero has one talent: left out, with a note.
    expect(fromFile.trees[2]).toBeUndefined();
    expect(fromFile.notes).toContain("npc_dota_hero_new: left as it was, 1 talents");

    // OpenDota lists Ability17 first here; with the file down, its order is used.
    const swapped = constants();
    swapped.talents.set(NPC, [...KEYS.slice(0, 6), KEYS[7]!, KEYS[6]!]);
    const down = await buildGameTalents(swapped, () => Promise.reject(new Error("HTTP 503")));
    expect(down.fromFiles).toBe(0);
    expect(down.renamed).toBeNull();
    expect(down.notes).toContain(`${NPC}: file failed (HTTP 503), OpenDota's order`);
    expect(down.notes).toContain("game talent names failed (HTTP 503), OpenDota's names");
    expect(down.trees[1]?.[3]?.map((t) => t.id)).toEqual([6012, 6353]);
  });

  // Anti-Mage after a letter patch: Ability10 is a talent OpenDota doesn't list yet, and Blink's talent got stronger.
  const NEW_TALENT = "special_bonus_hp_regen_4_5";
  const PATCHED = FILE.replace(`"${KEYS[0]}" // a comment`, `"${NEW_TALENT}"`);
  const TOOLTIPS = `"lang" { "Tokens" {
${KEYS.map((k, i) => `"DOTA_Tooltip_ability_${k}" "${NAMES[i]}"`).join("\n")}
"DOTA_Tooltip_Ability_${KEYS[4]}" "+{s:bonus_AbilityCastRange} Blink Cast Range"
"DOTA_Tooltip_ability_${NEW_TALENT}" "+{s:value} Health Regen"
"DOTA_Tooltip_ability_special_bonus_new" "+1 New"
} }`;
  const ABILITIES = `"DOTAAbilities" {
"antimage_blink" { "AbilityCastRange" { "value" "750" "${KEYS[4]}" "+150" } }
"${NEW_TALENT}" { "AbilityValues" { "value" { "value" "4.5" } } }
}`;
  const IDS_FILE = `"DOTAAbilityIDs" { "UnitAbilities" { "Locked" { "${NEW_TALENT}" "1956" "${KEYS[4]}" "6606" } } }`;
  const gameFiles = (url: string) =>
    Promise.resolve(
      url.endsWith("abilities_english.txt") ? TOOLTIPS : url.endsWith("npc_abilities.txt") ? ABILITIES : url.endsWith("ids.txt") ? IDS_FILE : PATCHED,
    );

  it("names talents from the game files, takes a talent OpenDota doesn't list yet and notes it", async () => {
    const urls: string[] = [];
    const built = await buildGameTalents(constants(), (url) => (urls.push(url), gameFiles(url)));
    expect(urls).toContain(`${GAME_FILES_URL}resource/localization/abilities_english.txt`);
    expect(built.fromFiles).toBe(1);
    expect(built.renamed).toBe(1);
    // Level 10: [Ability11, Ability10], the new talent on the right with the game's id.
    expect(built.trees[1]?.[0]).toEqual([
      { id: IDS[1], name: NAMES[1] },
      { id: 1956, name: "+4.5 Health Regen" },
    ]);
    // Level 20's right side is Ability14, Blink's cast range: the game's +150, not OpenDota's +125.
    expect(built.trees[1]?.[2]?.[1]).toEqual({ id: IDS[4], name: "+150 Blink Cast Range" });
    expect(built.notes).toContain(`${NPC}: talents OpenDota doesn't list yet, from the game file: ${NEW_TALENT}`);
  });

  it("keeps OpenDota's names when the game files name too few of its talents", () => {
    const c = constants();
    const few = withGameTexts(c, { names: new Map([[KEYS[0]!, "x"]]), ids: new Map() });
    expect(few).toEqual({ problem: "names for only 1 of 9 talents" });
    const all = withGameTexts(c, { names: new Map([...KEYS, "special_bonus_new"].map((k) => [k, k === KEYS[1] ? "+12% Mana Break" : (c.names.get(k) ?? "")])), ids: new Map([[KEYS[2]!, 1]]) });
    if ("problem" in all) throw new Error(all.problem);
    expect(all.renamed).toBe(1);
    // OpenDota's id wins over the game list's when both have one.
    expect(all.constants.ids.get(KEYS[2]!)).toBe(IDS[2]);
  });

  it("puts the trees on the snapshot's heroes and counts the changed ones", () => {
    const tree = [[{ id: 1, name: "+1 Armor" }, { id: 2, name: "+2 Armor" }]];
    const snapshot = { heroAbilities: { 18: { ...SVEN }, 19: { ...SVEN } } } as unknown as Snapshot; // Only heroAbilities is read.
    snapshot.heroAbilities![19]!.innate = ["Gone"];
    expect(applyGameTalents(snapshot, { 18: tree, 19: SVEN.talents, 20: tree }, { 18: ["Warcry Aura"] })).toBe(1);
    expect(snapshot.heroAbilities?.[18]).toMatchObject({ talents: tree, talentsFrom: "game", innate: ["Warcry Aura"] });
    expect(snapshot.heroAbilities?.[19]?.talentsFrom).toBe("game");
    // An innate ability the game no longer lists goes.
    expect(snapshot.heroAbilities?.[19]?.innate).toBeUndefined();
    expect(snapshot.heroAbilities?.[20]).toBeUndefined();
  });
});
