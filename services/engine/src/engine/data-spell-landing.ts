// Reviewed by hand against the game: where each spell's dispellable effect lands and what it does there.
// Covers every hero spell a dispel removes whose cast is not enemies-only (OpenDota's target_team can't say
// where the effect lands: Ghost Shroud has none, Decrepify an empty list). A test fails when a spell is missing,
// so a new hero or patch must be reviewed here. Keys are Dota's internal ability names, grouped by hero.
import type { Effect, Target } from "./spell-facts";

export const SPELL_LANDING: Readonly<Record<string, { lands: Target; effects?: readonly Effect[] }>> = {
  abaddon_aphotic_shield: { lands: "allies", effects: ["shield"] }, // Abaddon: Aphotic Shield
  abaddon_frostmourne: { lands: "both", effects: ["attack"] }, // Abaddon: Curse of Avernus
  alchemist_berserk_potion: { lands: "allies", effects: ["attack", "speed", "heal"] }, // Alchemist: Berserk Potion
  alchemist_unstable_concoction: { lands: "enemies" }, // Alchemist: Unstable Concoction
  antimage_counterspell: { lands: "allies", effects: ["spell block"] }, // Anti-Mage: Counterspell
  bane_nightmare: { lands: "both" }, // Bane: Nightmare
  batrider_flamebreak: { lands: "enemies" }, // Batrider: Flamebreak
  batrider_sticky_napalm_application_damage: { lands: "enemies" }, // Batrider: APPLICATION DAMAGE:
  bloodseeker_blood_bath: { lands: "enemies" }, // Bloodseeker: Blood Rite
  bloodseeker_bloodrage: { lands: "allies", effects: ["attack"] }, // Bloodseeker: Bloodrage
  brewmaster_cinder_brew: { lands: "enemies" }, // Brewmaster: Cinder Brew
  brewmaster_thunder_clap: { lands: "enemies" }, // Brewmaster: Thunder Clap
  bristleback_prickly: { lands: "enemies" }, // Bristleback: Prickly
  broodmother_incapacitating_bite: { lands: "enemies" }, // Broodmother: Incapacitating Bite
  centaur_hoof_stomp: { lands: "enemies" }, // Centaur Warrunner: Hoof Stomp
  centaur_return: { lands: "allies" }, // Centaur Warrunner: Retaliate
  chen_hand_of_god: { lands: "allies", effects: ["heal"] }, // Chen: Hand of God
  chen_zealot: { lands: "allies", effects: ["attack", "speed"] }, // Chen: Zealot
  rattletrap_hookshot: { lands: "enemies" }, // Clockwerk: Hookshot
  rattletrap_jetpack: { lands: "allies", effects: ["speed"] }, // Clockwerk: Jetpack
  crystal_maiden_crystal_nova: { lands: "enemies" }, // Crystal Maiden: Crystal Nova
  crystal_maiden_glacial_guard: { lands: "allies", effects: ["shield"] }, // Crystal Maiden: Glacial Guard
  dark_seer_ion_shell: { lands: "both" }, // Dark Seer: Ion Shell
  dark_seer_surge: { lands: "allies", effects: ["speed"] }, // Dark Seer: Surge
  dark_seer_vacuum: { lands: "enemies" }, // Dark Seer: Vacuum
  dawnbreaker_celestial_hammer: { lands: "enemies" }, // Dawnbreaker: Celestial Hammer
  death_prophet_silence: { lands: "enemies" }, // Death Prophet: Silence
  drow_ranger_wave_of_silence: { lands: "enemies" }, // Drow Ranger: Gust
  earth_spirit_boulder_smash: { lands: "enemies" }, // Earth Spirit: Boulder Smash
  earth_spirit_geomagnetic_grip: { lands: "enemies" }, // Earth Spirit: Geomagnetic Grip
  earth_spirit_magnetize: { lands: "enemies" }, // Earth Spirit: Magnetize
  earth_spirit_rolling_boulder: { lands: "enemies" }, // Earth Spirit: Rolling Boulder
  earthshaker_aftershock: { lands: "enemies" }, // Earthshaker: Aftershock
  elder_titan_ancestral_spirit: { lands: "both", effects: ["attack", "speed"] }, // Elder Titan: Astral Spirit
  elder_titan_echo_stomp: { lands: "enemies" }, // Elder Titan: Echo Stomp
  ember_spirit_flame_guard: { lands: "allies", effects: ["shield"] }, // Ember Spirit: Flame Guard
  ember_spirit_immolation: { lands: "enemies" }, // Ember Spirit: Immolation
  ember_spirit_searing_chains: { lands: "enemies" }, // Ember Spirit: Searing Chains
  enchantress_untouchable: { lands: "enemies" }, // Enchantress: Untouchable
  faceless_void_time_dilation: { lands: "enemies" }, // Faceless Void: Time Dilation
  faceless_void_time_lock: { lands: "enemies" }, // Faceless Void: Time Lock
  grimstroke_dark_artistry: { lands: "enemies" }, // Grimstroke: Stroke of Fate
  grimstroke_spirit_walk: { lands: "both", effects: ["speed"] }, // Grimstroke: Ink Swell
  gyrocopter_call_down: { lands: "enemies" }, // Gyrocopter: Call Down
  gyrocopter_rocket_barrage: { lands: "enemies" }, // Gyrocopter: Rocket Barrage
  hoodwink_bushwhack: { lands: "enemies" }, // Hoodwink: Bushwhack
  hoodwink_decoy: { lands: "allies", effects: ["speed"] }, // Hoodwink: Decoy
  hoodwink_hunters_boomerang: { lands: "enemies" }, // Hoodwink: Hunter's Boomerang
  hoodwink_sharpshooter: { lands: "enemies" }, // Hoodwink: Sharpshooter
  huskar_inner_fire: { lands: "enemies" }, // Huskar: Inner Fire
  invoker_alacrity: { lands: "allies", effects: ["attack"] }, // Invoker: Alacrity
  invoker_chaos_meteor: { lands: "enemies" }, // Invoker: Chaos Meteor
  invoker_quas: { lands: "allies", effects: ["heal"] }, // Invoker: Quas
  invoker_tornado: { lands: "enemies" }, // Invoker: Tornado
  keeper_of_the_light_blinding_light: { lands: "enemies" }, // Keeper of the Light: Blinding Light
  kez_shodo_sai: { lands: "enemies" }, // Kez: Shodo Sai
  kunkka_torrent: { lands: "enemies" }, // Kunkka: Torrent
  largo_croak_of_genius: { lands: "allies", effects: ["attack"] }, // Largo: Croak of Genius
  legion_commander_overwhelming_odds: { lands: "enemies" }, // Legion Commander: Overwhelming Odds
  legion_commander_press_the_attack: { lands: "allies", effects: ["attack", "speed", "heal"] }, // Legion Commander: Press The Attack
  lich_frost_shield: { lands: "allies", effects: ["shield"] }, // Lich: Frost Shield
  lina_light_strike_array: { lands: "enemies" }, // Lina: Light Strike Array
  lone_druid_savage_roar: { lands: "both", effects: ["speed"] }, // Lone Druid: Savage Roar
  lycan_howl: { lands: "enemies" }, // Lycan: Howl
  magnataur_empower: { lands: "allies", effects: ["attack"] }, // Magnus: Empower
  magnataur_reverse_polarity: { lands: "enemies" }, // Magnus: Reverse Polarity
  magnataur_skewer: { lands: "enemies" }, // Magnus: Skewer
  marci_bodyguard: { lands: "allies", effects: ["attack", "heal"] }, // Marci: Bodyguard
  marci_companion_run: { lands: "enemies" }, // Marci: Rebound
  marci_grapple: { lands: "enemies" }, // Marci: Dispose
  medusa_gorgon_grasp: { lands: "enemies" }, // Medusa: Gorgon's Grasp
  meepo_earthbind: { lands: "enemies" }, // Meepo: Earthbind
  mirana_arrow: { lands: "enemies" }, // Mirana: Sacred Arrow
  mirana_leap: { lands: "allies", effects: ["attack", "speed"] }, // Mirana: Leap
  monkey_king_primal_spring: { lands: "enemies" }, // Monkey King: Primal Spring
  muerta_the_calling: { lands: "enemies" }, // Muerta: The Calling
  naga_siren_rip_tide: { lands: "enemies" }, // Naga Siren: Rip Tide
  furion_teleportation: { lands: "allies", effects: ["shield"] }, // Nature's Prophet: Teleportation
  necrolyte_death_seeker: { lands: "both", effects: ["heal"] }, // Necrophos: Death Seeker
  necrolyte_ghost_shroud: { lands: "both", effects: ["unattackable", "heal"] }, // Necrophos: Ghost Shroud
  ogre_magi_bloodlust: { lands: "allies", effects: ["attack", "speed"] }, // Ogre Magi: Bloodlust
  ogre_magi_smash: { lands: "allies", effects: ["shield"] }, // Ogre Magi: Fire Shield
  omniknight_martyr: { lands: "allies", effects: ["debuff immune", "magic resist", "heal"] }, // Omniknight: Repel
  oracle_fates_edict: { lands: "both", effects: ["magic resist"] }, // Oracle: Fate's Edict
  oracle_fortunes_end: { lands: "enemies" }, // Oracle: Fortune's End
  oracle_purifying_flames: { lands: "both", effects: ["heal"] }, // Oracle: Purifying Flames
  obsidian_destroyer_objurgation: { lands: "allies", effects: ["shield"] }, // Outworld Devourer: Objurgation
  pangolier_lucky_shot: { lands: "enemies" }, // Pangolier: Lucky Shot
  pangolier_shield_crash: { lands: "both", effects: ["shield"] }, // Pangolier: Shield Crash
  phantom_assassin_phantom_strike: { lands: "allies", effects: ["attack"] }, // Phantom Assassin: Phantom Strike
  phantom_lancer_phantom_edge: { lands: "allies", effects: ["speed", "evasion"] }, // Phantom Lancer: Phantom Rush
  phoenix_fire_spirits: { lands: "enemies" }, // Phoenix: Fire Spirits
  phoenix_icarus_dive: { lands: "enemies" }, // Phoenix: Icarus Dive
  puck_waning_rift: { lands: "enemies" }, // Puck: Waning Rift
  pugna_decrepify: { lands: "both", effects: ["unattackable", "heal"] }, // Pugna: Decrepify
  razor_plasma_field: { lands: "enemies" }, // Razor: Plasma Field
  ringmaster_impalement: { lands: "enemies" }, // Ring Master: Impalement Arts
  ringmaster_tame_the_beasts: { lands: "enemies" }, // Ring Master: Tame the Beasts
  ringmaster_tame_the_beasts_crack: { lands: "enemies" }, // Ring Master: Crack
  ringmaster_the_box: { lands: "allies", effects: ["speed", "magic resist"] }, // Ring Master: Escape Act
  sandking_caustic_finale: { lands: "enemies" }, // Sand King: Caustic Finale
  nevermore_frenzy: { lands: "allies", effects: ["attack", "speed"] }, // Shadow Fiend: Feast of Souls
  nevermore_requiem: { lands: "enemies" }, // Shadow Fiend: Requiem of Souls
  nevermore_shadowraze1: { lands: "enemies" }, // Shadow Fiend: Shadowraze
  nevermore_shadowraze2: { lands: "enemies" }, // Shadow Fiend: Shadowraze
  nevermore_shadowraze3: { lands: "enemies" }, // Shadow Fiend: Shadowraze
  silencer_curse_of_the_silent: { lands: "enemies" }, // Silencer: Arcane Curse
  silencer_global_silence: { lands: "enemies" }, // Silencer: Global Silence
  skywrath_mage_concussive_shot: { lands: "enemies" }, // Skywrath Mage: Concussive Shot
  slardar_bash: { lands: "enemies" }, // Slardar: Bash of the Deep
  slardar_slithereen_crush: { lands: "enemies" }, // Slardar: Slithereen Crush
  slardar_sprint: { lands: "allies", effects: ["speed"] }, // Slardar: Guardian Sprint
  snapfire_firesnap_cookie: { lands: "enemies" }, // Snapfire: Firesnap Cookie
  spirit_breaker_bulldoze: { lands: "allies", effects: ["speed"] }, // Spirit Breaker: Bulldoze
  spirit_breaker_greater_bash: { lands: "enemies" }, // Spirit Breaker: Greater Bash
  spirit_breaker_planar_pocket: { lands: "both" }, // Spirit Breaker: Planar Pocket
  storm_spirit_overload: { lands: "enemies" }, // Storm Spirit: Overload
  sven_warcry: { lands: "allies", effects: ["armor", "speed"] }, // Sven: Warcry
  techies_land_mines: { lands: "enemies" }, // Techies: Proximity Mines
  techies_reactive_tazer: { lands: "allies", effects: ["speed"] }, // Techies: Reactive Tazer
  techies_sticky_bomb: { lands: "enemies" }, // Techies: Sticky Bomb
  templar_assassin_psionic_trap: { lands: "enemies" }, // Templar Assassin: Psionic Trap
  templar_assassin_trap: { lands: "enemies" }, // Templar Assassin: Trap
  terrorblade_reflection: { lands: "enemies" }, // Terrorblade: Reflection
  terrorblade_terror_wave: { lands: "enemies" }, // Terrorblade: Terror Wave
  tidehunter_anchor_smash: { lands: "enemies" }, // Tidehunter: Anchor Smash
  tidehunter_ravage: { lands: "enemies" }, // Tidehunter: Ravage
  shredder_whirling_death: { lands: "enemies" }, // Timbersaw: Whirling Death
  tiny_avalanche: { lands: "enemies" }, // Tiny: Avalanche
  treant_living_armor: { lands: "allies", effects: ["shield", "heal"] }, // Treant Protector: Living Armor
  treant_overgrowth: { lands: "enemies" }, // Treant Protector: Overgrowth
  troll_warlord_whirling_axes_melee: { lands: "enemies" }, // Troll Warlord: Whirling Axes (Melee)
  tusk_drinking_buddies: { lands: "allies", effects: ["speed", "armor"] }, // Tusk: Drinking Buddies
  abyssal_underlord_dark_portal: { lands: "allies" }, // Underlord: Fiend's Gate
  abyssal_underlord_firestorm: { lands: "enemies" }, // Underlord: Firestorm
  abyssal_underlord_pit_of_malice: { lands: "enemies" }, // Underlord: Pit of Malice
  ursa_earthshock: { lands: "enemies" }, // Ursa: Earthshock
  ursa_overpower: { lands: "allies", effects: ["attack"] }, // Ursa: Overpower
  vengefulspirit_nether_swap: { lands: "enemies" }, // Vengeful Spirit: Nether Swap
  vengefulspirit_wave_of_terror: { lands: "enemies" }, // Vengeful Spirit: Wave of Terror
  venomancer_poison_sting: { lands: "enemies" }, // Venomancer: Poison Sting
  venomancer_venomous_gale: { lands: "enemies" }, // Venomancer: Venomous Gale
  viper_corrosive_skin: { lands: "enemies" }, // Viper: Corrosive Skin
  viper_nose_dive: { lands: "enemies" }, // Viper: Nosedive
  viper_predator: { lands: "enemies" }, // Viper: Predator
  visage_summon_familiars_stone_form: { lands: "enemies" }, // Visage: Stone Form
  void_spirit_resonant_pulse: { lands: "allies", effects: ["shield"] }, // Void Spirit: Resonant Pulse
  warlock_eldritch_summoning: { lands: "enemies" }, // Warlock: Eldritch Summoning
  warlock_rain_of_chaos: { lands: "enemies" }, // Warlock: Chaotic Offering
  warlock_shadow_word: { lands: "both", effects: ["heal"] }, // Warlock: Shadow Word
  warlock_upheaval: { lands: "enemies" }, // Warlock: Upheaval
  windrunner_tailwind: { lands: "allies", effects: ["speed"] }, // Windranger: Tailwind
  windrunner_windrun: { lands: "allies", effects: ["evasion", "speed"] }, // Windranger: Windrun
  winter_wyvern_splinter_blast: { lands: "enemies" }, // Winter Wyvern: Splinter Blast
  skeleton_king_reincarnation: { lands: "both" }, // Wraith King: Reincarnation
  zuus_heavenly_jump: { lands: "enemies" }, // Zeus: Heavenly Jump
};

