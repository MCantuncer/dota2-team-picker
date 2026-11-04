/**
 * Each hero's one spell that hurts you most in a fight, with a short line on what it does to you, for
 * Their Threats (Can 2026-11-04 chose one row per enemy spell, as on the approved Game Story mockup).
 * Kept by hand, like the hard counters: OpenDota has no "most dangerous spell". Keys are Dota's internal
 * ability names (they name the ability art); matched by hero display name.
 */
export interface KeySpell {
  /** Dota's internal ability name, like `enigma_black_hole`. */
  key: string;
  /** The spell's name in game. */
  name: string;
  /** What it does to you, in a few words. */
  line: string;
  /**
   * How the spell hurts you: "attack" when it works through right clicks (Black King Bar does not stop
   * it), "magic" when it is a spell or disable (armor does not stop it), "other" when neither answers it.
   */
  kind: SpellKind;
}

export type SpellKind = "attack" | "magic" | "other";

/** Spells that work through right clicks. */
const ATTACK = new Set([
  "alchemist_chemical_rage", "chaos_knight_phantasm", "ember_spirit_sleight_of_fist", "legion_commander_duel", "clinkz_wind_walk", "drow_ranger_marksmanship",
  "gyrocopter_flak_cannon", "juggernaut_omni_slash", "life_stealer_rage", "lone_druid_spirit_bear",
  "lycan_shapeshift", "marci_unleash", "monkey_king_wukongs_command", "naga_siren_mirror_image",
  "night_stalker_darkness", "phantom_assassin_coup_de_grace", "phantom_lancer_juxtapose", "riki_backstab",
  "sven_gods_strength", "templar_assassin_refraction", "troll_warlord_battle_trance", "tusk_walrus_punch",
  "ursa_fury_swipes",
]);

/** Spells neither Black King Bar nor armor answers: lives, saves, global presence, and disables that go
 * through Black King Bar. */
const OTHER = new Set([
  "enigma_black_hole", "faceless_void_chronosphere", "magnataur_reverse_polarity", "bane_fiends_grip",
  "doom_bringer_doom", "beastmaster_primal_roar", "axe_berserkers_call",
  "abaddon_borrowed_time", "arc_warden_tempest_double", "bristleback_bristleback", "broodmother_spawn_spiderlings",
  "chen_hand_of_god", "dazzle_shallow_grave", "furion_teleportation", "mirana_invis", "nyx_assassin_vendetta",
  "oracle_false_promise", "slark_dark_pact", "spectre_haunt", "tinker_rearm", "weaver_time_lapse",
  "skeleton_king_reincarnation", "wisp_relocate", "abyssal_underlord_dark_portal", "omniknight_guardian_angel",
  "shadow_demon_disruption", "largo_amphibian_rhapsody", "techies_land_mines",
]);

const spell = (key: string, name: string, line: string): KeySpell => ({
  key,
  name,
  line,
  kind: ATTACK.has(key) ? "attack" : OTHER.has(key) ? "other" : "magic",
});

export const KEY_SPELLS: Record<string, KeySpell> = {
  Abaddon: spell("abaddon_borrowed_time", "Borrowed Time", "Your damage heals him for a few seconds"),
  Alchemist: spell("alchemist_chemical_rage", "Chemical Rage", "Fast attacks and regen once it is on"),
  "Ancient Apparition": spell("ancient_apparition_ice_blast", "Ice Blast", "No healing, and kills you below a tenth of your health"),
  "Anti-Mage": spell("antimage_mana_void", "Mana Void", "Big damage on heroes low on mana"),
  "Arc Warden": spell("arc_warden_tempest_double", "Tempest Double", "A second copy with all his items"),
  Axe: spell("axe_berserkers_call", "Berserker's Call", "Forces you to hit him while his team arrives"),
  Bane: spell("bane_fiends_grip", "Fiend's Grip", "Holds one hero still for seconds"),
  Batrider: spell("batrider_flaming_lasso", "Flaming Lasso", "Drags one hero into his team"),
  Beastmaster: spell("beastmaster_primal_roar", "Primal Roar", "A long stun that ignores Linken's"),
  Bloodseeker: spell("bloodseeker_rupture", "Rupture", "Moving hurts: walking out can kill you"),
  "Bounty Hunter": spell("bounty_hunter_track", "Track", "Shows you through the fog for his team"),
  Brewmaster: spell("brewmaster_primal_split", "Primal Split", "Splits into three brawlers that are hard to kill"),
  Bristleback: spell("bristleback_bristleback", "Bristleback", "Takes little damage from behind"),
  Broodmother: spell("broodmother_spawn_spiderlings", "Spawn Spiderlings", "Spiders take lanes and towers fast"),
  "Centaur Warrunner": spell("centaur_stampede", "Stampede", "His whole team runs at you at once"),
  "Chaos Knight": spell("chaos_knight_phantasm", "Phantasm", "Illusions that hit as hard as he does"),
  Chen: spell("chen_hand_of_god", "Hand of God", "Heals his whole team on the map"),
  Clinkz: spell("clinkz_wind_walk", "Skeleton Walk", "Invisible until he shoots you"),
  Clockwerk: spell("rattletrap_hookshot", "Hookshot", "Lands on you from far away"),
  "Crystal Maiden": spell("crystal_maiden_freezing_field", "Freezing Field", "Huge area damage if she is left alone"),
  "Dark Seer": spell("dark_seer_wall_of_replica", "Wall of Replica", "Copies of your team fight against you"),
  "Dark Willow": spell("dark_willow_terrorize", "Terrorize", "Makes your whole team run away"),
  Dawnbreaker: spell("dawnbreaker_solar_guardian", "Solar Guardian", "Lands on any fight on the map"),
  Dazzle: spell("dazzle_shallow_grave", "Shallow Grave", "Their hero can't die for a few seconds"),
  "Death Prophet": spell("death_prophet_exorcism", "Exorcism", "Spirits tear down heroes and towers"),
  Disruptor: spell("disruptor_static_storm", "Static Storm", "Silences, and mutes items with his scepter"),
  Doom: spell("doom_bringer_doom", "Doom", "No spells and no items, even through Black King Bar"),
  "Dragon Knight": spell("dragon_knight_dragon_tail", "Dragon Tail", "A stun from range in dragon form"),
  "Drow Ranger": spell("drow_ranger_marksmanship", "Marksmanship", "Hard hitting arrows from far away"),
  "Earth Spirit": spell("earth_spirit_magnetize", "Magnetize", "Damage that spreads through your team"),
  Earthshaker: spell("earthshaker_echo_slam", "Echo Slam", "Hits harder the more of you stand together"),
  "Elder Titan": spell("elder_titan_natural_order", "Natural Order", "Takes your armor and magic resistance"),
  "Ember Spirit": spell("ember_spirit_sleight_of_fist", "legion_commander_duel", "Sleight of Fist", "Hits everyone nearby and can't be caught"),
  Enchantress: spell("enchantress_impetus", "Impetus", "Hits harder from far away"),
  Enigma: spell("enigma_black_hole", "Black Hole", "Holds your whole team, even through Black King Bar"),
  "Faceless Void": spell("faceless_void_chronosphere", "Chronosphere", "Freezes everyone inside but him"),
  Grimstroke: spell("grimstroke_soul_chain", "Soulbind", "Chains two heroes: a stun hits both"),
  Gyrocopter: spell("gyrocopter_flak_cannon", "Flak Cannon", "Hits every hero near you"),
  Hoodwink: spell("hoodwink_bushwhack", "Bushwhack", "Holds you against trees"),
  Huskar: spell("huskar_life_break", "Life Break", "Jumps on you and takes a chunk of your health"),
  Invoker: spell("invoker_tornado", "Tornado", "Lifts your team before his combo lands"),
  Io: spell("wisp_relocate", "Relocate", "Brings his ally into any fight on the map"),
  Jakiro: spell("jakiro_macropyre", "Macropyre", "A line of fire that hurts to stand in"),
  Juggernaut: spell("juggernaut_omni_slash", "Omnislash", "Slashes one hero to death"),
  "Keeper of the Light": spell("keeper_of_the_light_illuminate", "Illuminate", "A long wave of damage"),
  Kez: spell("kez_raptor_dance", "Raptor Dance", "Can't be hit while he hurts everyone near"),
  Kunkka: spell("kunkka_ghostship", "Ghostship", "Stuns your team and saves his"),
  Largo: spell("largo_amphibian_rhapsody", "Amphibian Rhapsody", "Songs that buff his team in fights"),
  "Legion Commander": spell("legion_commander_duel", "Duel", "Locks one hero in a fight to the death"),
  Leshrac: spell("leshrac_pulse_nova", "Pulse Nova", "Hurts everyone near him all the time"),
  Lich: spell("lich_chain_frost", "Chain Frost", "Bounces between heroes standing close"),
  Lifestealer: spell("life_stealer_rage", "Rage", "Spells can't touch him while it is on"),
  Lina: spell("lina_laguna_blade", "Laguna Blade", "One burst that kills a hero"),
  Lion: spell("lion_voodoo", "Hex", "Turns you into a frog: no spells, no items"),
  "Lone Druid": spell("lone_druid_spirit_bear", "Spirit Bear", "A second carry that roots you"),
  Luna: spell("luna_eclipse", "Eclipse", "Beams on everyone near her"),
  Lycan: spell("lycan_shapeshift", "Shapeshift", "Fast wolves that kill you before you see them"),
  Magnus: spell("magnataur_reverse_polarity", "Reverse Polarity", "Stuns your whole team at once"),
  Marci: spell("marci_unleash", "Unleash", "Fast hits that slow everyone around"),
  Mars: spell("mars_arena_of_blood", "Arena of Blood", "Walls you in with his team"),
  Medusa: spell("medusa_stone_gaze", "Stone Gaze", "Looking at her turns you to stone"),
  Meepo: spell("meepo_poof", "Poof", "Many Meepos land on one hero"),
  Mirana: spell("mirana_invis", "Moonlight Shadow", "Her whole team goes invisible"),
  "Monkey King": spell("monkey_king_wukongs_command", "Wukong's Command", "A ring of soldiers that hit inside it"),
  Morphling: spell("morphling_waveform", "Waveform", "Gets in and out before you can react"),
  Muerta: spell("muerta_pierce_the_veil", "Pierce the Veil", "Her shots go through armor"),
  "Naga Siren": spell("naga_siren_mirror_image", "Mirror Image", "Illusions split your damage"),
  "Nature's Prophet": spell("furion_teleportation", "Teleportation", "Joins any fight or pushes the other lane"),
  Necrophos: spell("necrolyte_reapers_scythe", "Reaper's Scythe", "Kills heroes low on health"),
  "Night Stalker": spell("night_stalker_darkness", "Dark Ascension", "Flies over walls and blinds you at night"),
  "Nyx Assassin": spell("nyx_assassin_vendetta", "Vendetta", "Invisible, then a big first hit"),
  "Ogre Magi": spell("ogre_magi_fireblast", "Fireblast", "Two or three stuns in a row with Multicast"),
  Omniknight: spell("omniknight_guardian_angel", "Guardian Angel", "His team takes no right-click damage"),
  Oracle: spell("oracle_false_promise", "False Promise", "Delays all damage and heals instead"),
  "Outworld Devourer": spell("obsidian_destroyer_sanity_eclipse", "Sanity's Eclipse", "Big damage if your mana is low"),
  Pangolier: spell("pangolier_gyroshell", "Rolling Thunder", "Rolls into your team and stuns"),
  "Phantom Assassin": spell("phantom_assassin_coup_de_grace", "Coup de Grace", "Critical hits that kill in seconds"),
  "Phantom Lancer": spell("phantom_lancer_juxtapose", "Juxtapose", "Illusions that fill the screen"),
  Phoenix: spell("phoenix_supernova", "Supernova", "Stuns everyone near the sun"),
  "Primal Beast": spell("primal_beast_pulverize", "Pulverize", "Holds one hero and smashes everyone near"),
  Puck: spell("puck_dream_coil", "Dream Coil", "Stuns you again if you walk out"),
  Pudge: spell("pudge_meat_hook", "Meat Hook", "Pulls you out of position"),
  Pugna: spell("pugna_life_drain", "Life Drain", "Pulls health out of one hero"),
  "Queen of Pain": spell("queenofpain_sonic_wave", "Sonic Wave", "A wave of pure damage"),
  Razor: spell("razor_static_link", "Static Link", "Steals your attack damage"),
  Riki: spell("riki_backstab", "Cloak and Dagger", "Invisible, and hits hard from behind"),
  "Ring Master": spell("ringmaster_wheel", "Wheel of Wonder", "Stuns everyone who looks at it"),
  Rubick: spell("rubick_spell_steal", "Spell Steal", "Uses your team's best spell against you"),
  "Sand King": spell("sandking_epicenter", "Epicenter", "Pulses of damage around him"),
  "Shadow Demon": spell("shadow_demon_disruption", "Disruption", "Hides a hero and makes copies"),
  "Shadow Fiend": spell("nevermore_requiem", "Requiem of Souls", "Big area damage when he blinks in"),
  "Shadow Shaman": spell("shadow_shaman_shackles", "Shackles", "Holds one hero still while wards hit"),
  Silencer: spell("silencer_global_silence", "Global Silence", "No spells for your whole team"),
  "Skywrath Mage": spell("skywrath_mage_mystic_flare", "Mystic Flare", "Huge damage on one hero"),
  Slardar: spell("slardar_amplify_damage", "Corrosive Haze", "Takes your armor and shows you"),
  Slark: spell("slark_dark_pact", "Dark Pact", "Removes stuns and slows from himself"),
  Snapfire: spell("snapfire_mortimer_kisses", "Mortimer Kisses", "Fireballs from far away"),
  Sniper: spell("sniper_assassinate", "Assassinate", "Finishes you from across the map"),
  Spectre: spell("spectre_haunt", "Haunt", "Joins any fight on the map"),
  "Spirit Breaker": spell("spirit_breaker_charge_of_darkness", "Charge of Darkness", "Charges you from across the map"),
  "Storm Spirit": spell("storm_spirit_ball_lightning", "Ball Lightning", "Flies onto you and away again"),
  Sven: spell("sven_gods_strength", "God's Strength", "Cleaves your whole team"),
  Techies: spell("techies_land_mines", "Proximity Mines", "Hidden mines on paths"),
  "Templar Assassin": spell("templar_assassin_refraction", "Refraction", "Blocks your damage and hits hard"),
  Terrorblade: spell("terrorblade_sunder", "Sunder", "Swaps his low health for yours"),
  Tidehunter: spell("tidehunter_ravage", "Ravage", "Stuns your whole team around him"),
  Timbersaw: spell("shredder_chakram", "Chakram", "Pure damage that zones you"),
  Tinker: spell("tinker_rearm", "Rearm", "Uses every spell and item twice"),
  Tiny: spell("tiny_toss", "Toss", "Throws you into his team"),
  "Treant Protector": spell("treant_overgrowth", "Overgrowth", "Roots your whole team"),
  "Troll Warlord": spell("troll_warlord_battle_trance", "Battle Trance", "Fast attacks and he can't die"),
  Tusk: spell("tusk_walrus_punch", "Walrus PUNCH!", "A big critical hit that lifts you"),
  Underlord: spell("abyssal_underlord_dark_portal", "Fiend's Gate", "Brings his team across the map"),
  Undying: spell("undying_tombstone", "Tombstone", "Zombies that slow everyone"),
  Ursa: spell("ursa_fury_swipes", "Fury Swipes", "Each hit on you hurts more"),
  "Vengeful Spirit": spell("vengefulspirit_nether_swap", "Nether Swap", "Swaps you into his team"),
  Venomancer: spell("venomancer_noxious_plague", "Noxious Plague", "Poison that hurts everyone near you"),
  Viper: spell("viper_viper_strike", "Viper Strike", "Slows you to a crawl"),
  Visage: spell("visage_summon_familiars", "Summon Familiars", "Birds that stun and hit hard"),
  "Void Spirit": spell("void_spirit_astral_step", "Astral Step", "Dashes through you and away"),
  Warlock: spell("warlock_rain_of_chaos", "Chaotic Offering", "A golem that stuns and burns"),
  Weaver: spell("weaver_time_lapse", "Time Lapse", "Goes back to full health"),
  Windranger: spell("windrunner_shackleshot", "Shackleshot", "Ties you to a tree or hero"),
  "Winter Wyvern": spell("winter_wyvern_winters_curse", "Winter's Curse", "Makes your team hit their own hero"),
  "Witch Doctor": spell("witch_doctor_death_ward", "Death Ward", "Channels from behind his team"),
  "Wraith King": spell("skeleton_king_reincarnation", "Reincarnation", "Comes back to life once"),
  Zeus: spell("zuus_thundergods_wrath", "Thundergod's Wrath", "Hits every hero on the map"),
};
