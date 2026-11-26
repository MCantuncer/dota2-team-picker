import { describe, expect, it } from "vitest";
import { abilityIds, gameTalentTexts, parseKV, talentText, talentTooltips, talentValues } from "../src/data/talent-texts";

// Abaddon's Curse of Avernus after 7.42a, as the hero file has it: the talent's value sits in the ability's own block.
const HERO = `"DOTAHeroes"
{
  "npc_dota_hero_abaddon"
  {
    "Ability10"  "special_bonus_unique_abaddon_5" // comment with "quotes" and { a brace
    "abaddon_frostmourne"
    {
      "AbilityValues"
      {
        "curse_dps"
        {
          "value"                           "12 20 28 36"
          "special_bonus_unique_abaddon_5"  "+20"
        }
        "slow"  [$WIN32] "10"
      }
    }
    "special_bonus_unique_abaddon_5"
    {
      "AbilityType"  "ABILITY_TYPE_ATTRIBUTES"
    }
  }
}`;

const ABILITIES = `"DOTAAbilities"
{
  "pudge_rot" { "AbilityValues" { "rot_slow" { "value" "-20" "special_bonus_unique_pudge_4" "+-10" } } }
  "special_bonus_hp_regen_4_5" { "AbilityValues" { "value" { "value" "4.5" } } }
  "special_bonus_strength_10" { "AbilityValues" { "value" "10" } }
  "chen_zealot" { "AbilityValues" { "bonus" { "value" "0" "special_bonus_unique_chen_zealot" "+25%" } } }
}`;

const TOOLTIPS = `"lang"
{
  "Tokens"
  {
    "DOTA_Tooltip_ability_special_bonus_unique_abaddon_5"  "+{s:bonus_curse_dps} Curse of Avernus DPS"
    "DOTA_Tooltip_ability_special_bonus_unique_abaddon_5_Description"  "Not a name"
    "DOTA_Tooltip_Ability_special_bonus_unique_pudge_4"  "+{s:bonus_rot_slow}%% Rot Slow"
    "DOTA_Tooltip_ability_special_bonus_hp_regen_4_5"  "+{s:value} Health Regen"
    "DOTA_Tooltip_ability_special_bonus_strength_10"  "+{s:value} <b>Strength</b>"
    "DOTA_Tooltip_ability_special_bonus_unique_chen_zealot"  "Zealot gains +{s:bonus_bonus}% Health"
    "DOTA_Tooltip_ability_special_bonus_unique_missing"  "+{s:value} Nothing"
    "DOTA_Tooltip_ability_abaddon_frostmourne"  "Curse of Avernus"
  }
}`;

const IDS = `"DOTAAbilityIDs" { "UnitAbilities" { "Locked" { "special_bonus_hp_regen_4_5" "1956" "special_bonus_strength_10" "5000" } } }`;

describe("talent texts from the game files", () => {
  it("reads KeyValues: comments, platform tags, nested blocks, braces on the next line", () => {
    const kv = parseKV(HERO);
    const hero = kv.DOTAHeroes as Record<string, unknown>;
    const abaddon = hero.npc_dota_hero_abaddon as Record<string, unknown>;
    expect(abaddon.Ability10).toBe("special_bonus_unique_abaddon_5");
    expect(((abaddon.abaddon_frostmourne as Record<string, unknown>).AbilityValues as Record<string, unknown>).slow).toBe("10");
    // A stray closing brace is ignored, not thrown on.
    expect(parseKV(`} "a" "1"`)).toEqual({ a: "1" });
  });

  it("finds each talent's own values and the ability values it changes", () => {
    const values = talentValues([parseKV(HERO), parseKV(ABILITIES)]);
    expect(values.get("special_bonus_unique_abaddon_5")).toEqual(new Map([["bonus_curse_dps", "+20"]]));
    expect(values.get("special_bonus_hp_regen_4_5")).toEqual(new Map([["value", "4.5"]]));
    expect(values.get("special_bonus_strength_10")).toEqual(new Map([["value", "10"]]));
  });

  it("keeps only the talents' own tooltip lines, either spelling of the prefix", () => {
    const tips = talentTooltips(parseKV(TOOLTIPS));
    expect(tips.get("special_bonus_unique_pudge_4")).toBe("+{s:bonus_rot_slow}%% Rot Slow");
    expect(tips.has("special_bonus_unique_abaddon_5_Description")).toBe(false);
    expect(tips.has("abaddon_frostmourne")).toBe(false);
  });

  it("fills in the values without their signs, and gives up on a value it can't fill", () => {
    const v = (entries: [string, string][]) => new Map(entries);
    expect(talentText("+{s:bonus_curse_dps} Curse of Avernus DPS", v([["bonus_curse_dps", "+20"]]))).toBe("+20 Curse of Avernus DPS");
    expect(talentText("-{s:bonus_cd}s  Cooldown", v([["bonus_cd", "-0.5"]]))).toBe("-0.5s Cooldown");
    // A lone {s:value} takes the one value the talent changes elsewhere.
    expect(talentText("+{s:value} Damage", v([["bonus_damage", "+15"]]))).toBe("+15 Damage");
    expect(talentText("+{s:value} Damage", undefined)).toBeNull();
    // A value per level is not one number.
    expect(talentText("+{s:bonus_x} Damage", v([["bonus_x", "10 20"]]))).toBeNull();
    expect(talentText("Poison Touch Undispellable", undefined)).toBe("Poison Touch Undispellable");
    expect(talentText("<<b>script>Gains Aura", undefined)).toBe("scriptGains Aura");
  });

  it("names every talent it can and reads the game's ids", () => {
    const texts = gameTalentTexts(parseKV(TOOLTIPS), [parseKV(HERO), parseKV(ABILITIES)], parseKV(IDS));
    expect(Object.fromEntries(texts.names)).toEqual({
      special_bonus_unique_abaddon_5: "+20 Curse of Avernus DPS",
      special_bonus_unique_pudge_4: "+10% Rot Slow",
      special_bonus_hp_regen_4_5: "+4.5 Health Regen",
      special_bonus_strength_10: "+10 Strength",
      special_bonus_unique_chen_zealot: "Zealot gains +25% Health",
    });
    expect(texts.ids.get("special_bonus_hp_regen_4_5")).toBe(1956);
    expect(abilityIds(parseKV(`"a" { "x" "0" "y" "abc" }`)).size).toBe(0);
  });
});
