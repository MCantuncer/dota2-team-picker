import { describe, expect, it } from "vitest";
import { toLaneFacts, toLaneSpell, toNumbers } from "../src/data/lane-facts";
import { LANE_FACTS } from "../src/engine/data-lane-facts";
import { armorMultiplier, atLevel, damageTaken, heroStatsAt, laneHero, laneSpell } from "../src/engine/lane-facts";

const heroes = {
  36: {
    name: "npc_dota_hero_necrolyte",
    primary_attr: "int",
    base_health: 200,
    base_mana: 75,
    base_armor: 2,
    base_mr: 25,
    base_attack_min: 26,
    base_attack_max: 30,
    base_str: 18,
    str_gain: 2.3,
    base_agi: 12,
    agi_gain: 1.3,
    base_int: 23,
    int_gain: 2.7,
    attack_range: 500,
    attack_rate: 1.7,
    move_speed: 280,
  },
  999: { name: "npc_dota_hero_broken", primary_attr: "int" },
};
const heroAbilities = {
  npc_dota_hero_necrolyte: { abilities: ["necrolyte_death_pulse", "necrolyte_sadist", "necrolyte_ghost_shroud"] },
  npc_dota_hero_broken: { abilities: [] },
};
const abilities = {
  necrolyte_death_pulse: {
    dname: "Death Pulse",
    behavior: "No Target",
    dmg_type: "Magical",
    dmg: ["100", "160", "220", "280"],
    cd: ["8", "7", "6", "5"],
    mc: ["115", "130", "145", "160"],
    attrib: [
      { key: "area_of_effect", header: "RADIUS:", value: "500" },
      { key: "heal", header: "HEAL:", value: ["70", "90", "110", "130"] },
    ],
  },
  necrolyte_sadist: { dname: "Sadist", is_innate: true, behavior: ["Passive"], attrib: [{ key: "regen", header: "REGEN:", value: "3" }] },
  // Nothing a lane rule reads: left out.
  necrolyte_ghost_shroud: { dname: "Ghost Shroud", behavior: ["No Target"], cd: "20" },
};

describe("toLaneFacts", () => {
  it("keeps heroes with full base numbers and their spells that matter in lane", () => {
    const facts = toLaneFacts(abilities, heroAbilities, heroes);
    expect(Object.keys(facts.heroes)).toEqual(["36"]);
    expect(facts.heroes["36"]).toMatchObject({ name: "necrolyte", primary: "int", baseHealth: 200, str: [18, 2.3], spells: ["necrolyte_death_pulse"] });
    expect(facts.spells.necrolyte_death_pulse).toEqual({
      key: "necrolyte_death_pulse",
      name: "Death Pulse",
      cast: "none",
      damage: [100, 160, 220, 280],
      damageType: "magical",
      cooldown: [8, 7, 6, 5],
      mana: [115, 130, 145, 160],
      radius: [500],
      heal: [70, 90, 110, 130],
      hitsUnits: true,
    });
  });

  it("throws on constants that are not objects", () => {
    expect(() => toLaneFacts([], heroAbilities, heroes)).toThrow();
  });
});

describe("toLaneSpell", () => {
  it("reads a line spell's width and length, never a pull distance", () => {
    const spell = toLaneSpell(
      "magnataur_shockwave",
      {
        dname: "Shockwave",
        behavior: ["Unit Target", "Point Target"],
        dmg_type: "Magical",
        target_type: ["Hero", "Basic"],
        attrib: [
          { key: "shock_width", header: "SHOCK WIDTH:", value: "200" },
          { key: "shock_damage", header: "DAMAGE:", value: ["90", "160", "230", "300"] },
          { key: "pull_distance", header: "PULL DISTANCE:", value: "150" },
          { key: "abilitycastrange", header: "CAST RANGE:", value: "1200" },
        ],
      },
      new Map(),
    );
    expect(spell).toMatchObject({ cast: "point", damage: [90, 160, 230, 300], width: 200, length: 1200, castRange: [1200], hitsUnits: true });
  });

  it("levels a summon's health by the ability its label names, and leaves the unit's attack out of the damage", () => {
    const spell = toLaneSpell(
      "invoker_forge_spirit",
      {
        dname: "Forge Spirit",
        behavior: ["No Target", "Hidden"],
        attrib: [
          { key: "spirit_damage", header: "DAMAGE (EXORT):\\n", value: ["20", "30"] },
          { key: "spirit_hp", header: "HEALTH (QUAS):\\n", value: ["300", "400"] },
        ],
      },
      new Map([["QUAS", "invoker_quas"]]),
    );
    expect(spell).toMatchObject({ summonHealth: [300, 400], levelFrom: { summonHealth: "invoker_quas" } });
    expect(spell?.damage).toBeUndefined();
  });

  it("adds a damage-over-time spell's first seconds to its damage", () => {
    const spell = toLaneSpell(
      "x_burn",
      {
        dname: "Burn",
        behavior: "Unit Target",
        dmg_type: "Magical",
        attrib: [
          { key: "damage", header: "DAMAGE:", value: ["50"] },
          { key: "dps", header: "DAMAGE PER SECOND:", value: ["10", "20"] },
          { key: "duration", header: "DURATION:", value: "6" },
        ],
      },
      new Map(),
    );
    expect(spell?.damage).toEqual([90, 130]);
  });

  it("reads a spell's own name for its hit, a rolled hit's average, and leaves bonus numbers out", () => {
    const spell = (attrib: { key: string; header: string; value: unknown }[], dmg_type = "Magical") =>
      toLaneSpell("x", { dname: "X", behavior: "Unit Target", dmg_type, attrib }, new Map());
    expect(spell([{ key: "beam_damage", header: "BEAM DAMAGE:", value: ["75", "150"] }])?.damage).toEqual([75, 150]);
    expect(spell([{ key: "quill_base_damage", header: "QUILL BASE DAMAGE:", value: "25" }])?.damage).toEqual([25]);
    expect(
      spell([
        { key: "damage_min", header: "MINIMUM DAMAGE:", value: ["100", "150"] },
        { key: "damage_max", header: "MAXIMUM DAMAGE:", value: ["150", "210"] },
      ])?.damage,
    ).toEqual([125, 180]);
    expect(spell([{ key: "bonus_damage", header: "BONUS DAMAGE:", value: "40" }])?.damage).toBeUndefined();
    expect(spell([{ key: "jump_damage", header: "INCREMENTAL DAMAGE:", value: "20" }])?.damage).toBeUndefined();
    // No damage type: the number is not a hit on a hero.
    expect(spell([{ key: "damage", header: "EXTRA DAMAGE:", value: "400" }], "None")?.damage).toBeUndefined();
  });

  it("counts a heal-or-damage number with a plain duration as per second, and without one as a single hit", () => {
    const spell = (attrib: { key: string; header: string; value: unknown }[]) =>
      toLaneSpell("x", { dname: "X", behavior: "Unit Target", dmg_type: "Magical", attrib }, new Map());
    expect(spell([{ key: "damage", header: "DAMAGE/HEAL:", value: ["95", "170"] }])?.damage).toEqual([95, 170]);
    expect(
      spell([
        { key: "damage", header: "HEAL/DAMAGE:", value: ["15", "25"] },
        { key: "duration", header: "DURATION:", value: "10" },
      ])?.damage,
    ).toEqual([60, 100]);
  });

  it("reads a damaging aura as a share of health each second", () => {
    const spell = toLaneSpell(
      "necrolyte_heartstopper_aura",
      {
        dname: "Heartstopper Aura",
        behavior: "Passive",
        attrib: [
          { key: "aura_radius", header: "RADIUS:", value: "700" },
          { key: "aura_damage", header: "HEALTH DECAY:", value: ["0.8%", "1.3%"] },
        ],
      },
      new Map(),
    );
    expect(spell).toMatchObject({ passive: true, aura: { radius: 700, healthPerSecondPct: [0.8, 1.3] } });
    expect(spell?.cast).toBeUndefined();
  });
});

describe("toNumbers", () => {
  it("reads numbers, numeric strings and percents, and nothing from a list with a word in it", () => {
    expect(toNumbers(["1", 2, "3%"])).toEqual({ values: [1, 2, 3], isPercent: true });
    expect(toNumbers(["1", "fast"])).toEqual({ values: [], isPercent: false });
  });
});

describe("heroStatsAt", () => {
  const hero = {
    name: "necrolyte",
    primary: "int" as const,
    baseHealth: 200,
    baseMana: 75,
    baseArmor: 2,
    baseMagicResist: 25,
    attackMin: 26,
    attackMax: 30,
    attackRange: 500,
    attackRate: 1.7,
    moveSpeed: 280,
    str: [18, 2.3] as [number, number],
    agi: [12, 1.3] as [number, number],
    int: [23, 2.7] as [number, number],
    spells: [],
  };

  it("uses the 7.42 attribute rules: 200 base health and 20 per strength", () => {
    const at6 = heroStatsAt(hero, 6);
    expect(at6.health).toBeCloseTo(200 + 20 * (18 + 2.3 * 5));
    expect(at6.mana).toBeCloseTo(75 + 12 * (23 + 2.7 * 5));
    expect(at6.armor).toBeCloseTo(2 + (12 + 1.3 * 5) / 6);
    expect(at6.attackDamage).toBeCloseTo(28 + 23 + 2.7 * 5);
    // 25% base and 0.125% per intelligence, stacked.
    expect(at6.magicResist).toBeCloseTo(100 * (1 - 0.75 * (1 - 0.00125 * 36.5)));
  });

  it("adds attribute points from spells", () => {
    expect(heroStatsAt(hero, 1, { str: 2 }).health - heroStatsAt(hero, 1).health).toBeCloseTo(40);
  });
});

describe("damage helpers", () => {
  it("reduce damage by armor or magic resistance, and never pure damage", () => {
    expect(armorMultiplier(0)).toBe(1);
    expect(armorMultiplier(5)).toBeCloseTo(1 - 0.3 / 1.3);
    const target = { level: 1, health: 600, mana: 300, armor: 5, magicResist: 25, attackDamage: 50, attackRange: 500, moveSpeed: 300, attackInterval: 1.5 };
    expect(damageTaken(100, "magical", target)).toBeCloseTo(75);
    expect(damageTaken(100, "physical", target)).toBeCloseTo(100 * armorMultiplier(5));
    expect(damageTaken(100, "pure", target)).toBe(100);
  });

  it("read a spell value at a level, holding the last value past the end", () => {
    expect(atLevel([1, 2, 3], 2)).toBe(2);
    expect(atLevel([7], 4)).toBe(7);
    expect(atLevel([1, 2], 0)).toBeUndefined();
  });
});

describe("generated lane facts", () => {
  it("cover every hero with base numbers", () => {
    expect(Object.keys(LANE_FACTS.heroes).length).toBeGreaterThanOrEqual(120);
    expect(laneHero(36)?.baseHealth).toBe(200);
  });

  it("list only spells the file has, and match the 7.42 game numbers for spells the rules lean on", () => {
    for (const hero of Object.values(LANE_FACTS.heroes)) for (const key of hero.spells) expect(LANE_FACTS.spells[key], key).toBeDefined();
    expect(laneSpell("lina_dragon_slave")).toMatchObject({ damage: [65, 125, 185, 245], width: 275, length: 1075, hitsUnits: true });
    expect(laneSpell("lina_light_strike_array")).toMatchObject({ castPoint: 0.45, delay: 0.5, radius: [250] });
    expect(laneSpell("magnataur_shockwave")).toMatchObject({ width: 200, cooldown: [13, 12, 11, 10] });
    expect(laneSpell("invoker_forge_spirit")?.summonHealth?.[0]).toBe(300);
    expect(laneSpell("necrolyte_heartstopper_aura")?.aura?.radius).toBe(700);
  });
});
