// GENERATED FILE -- do not edit by hand.
//
// The item ids and NPC sprite ids the Wispbound engine implements, written by
// tools/registry_to_editor_catalog.py in the game repo (run through
// tools/generate_assets.sh) from src/assets/item_registry.c and
// src/assets/npc_registry.c. Regenerate it there rather than editing
// this; a name typed into the world editor is matched against those registries
// with strcmp, so this file and they must agree exactly.
//
// The lists are a convenience, not a limit: the world JSON stores whatever
// string is authored and the engine resolves it by name at map load, so the
// editor keeps an "Other (type a name)..." escape hatch for a world authored
// ahead of the code.

export const KNOWN_ITEMS = [
  { value: "icebreaker_pick", label: "icebreaker_pick — ICEBREAKER PICK (passage)" },
  { value: "tide_charm", label: "tide_charm — TIDE CHARM (passage)" },
  { value: "climbing_spikes", label: "climbing_spikes — CLIMBING SPIKES (passage)" },
  { value: "blast_powder", label: "blast_powder — BLAST POWDER (passage)" },
  { value: "thornhewn_machete", label: "thornhewn_machete — THORNHEWN MACHETE (passage)" },
  { value: "waking_bell", label: "waking_bell — WAKING BELL (passage)" },
  { value: "traversal_west", label: "traversal_west — WEST TRAVERSAL (traversal)" },
  { value: "traversal_east", label: "traversal_east — EAST TRAVERSAL (traversal)" },
  { value: "traversal_forest", label: "traversal_forest — FOREST TRAVERSAL (traversal)" },
  { value: "orb_blue", label: "orb_blue — BLUE ORB (orb, lost on death)" },
  { value: "orb_red", label: "orb_red — RED ORB (orb, lost on death)" },
  { value: "orb_green", label: "orb_green — GREEN ORB (orb, lost on death)" },
  { value: "meteorite_ore", label: "meteorite_ore — METEORITE ORE (ore)" },
  { value: "green_ore", label: "green_ore — GREEN ORE (ore)" },
  { value: "blue_ore", label: "blue_ore — BLUE ORE (ore)" },
  { value: "red_ore", label: "red_ore — RED ORE (ore)" },
  { value: "sturdy_shield", label: "sturdy_shield — STURDY SHIELD (combat)" },
  { value: "magic_sword", label: "magic_sword — MAGIC SWORD (combat)" },
  { value: "healing_herb", label: "healing_herb — HEALING HERB (consumable)" },
  { value: "healing_tonic", label: "healing_tonic — HEALING TONIC (consumable)" },
];

export const KNOWN_NPC_SPRITES = [
  { value: "Innkeeper", label: "Innkeeper — talkable, offers a scene" },
  { value: "Blacksmith", label: "Blacksmith — talkable, imbue service" },
  { value: "Mystic", label: "Mystic — talkable" },
  { value: "Cook", label: "Cook — talkable" },
  { value: "Captain", label: "Captain — talkable, one-time sail offer" },
  { value: "torch", label: "torch — scenery" },
  { value: "box", label: "box — object, pushed by walking into it" },
  { value: "ice_block", label: "ice_block — object, shattered with the icebreaker pick" },
  { value: "box_reset", label: "box_reset — object, pushed by walking into it" },
  { value: "snapjaw", label: "snapjaw — boss encounter" },
  { value: "quakehorn", label: "quakehorn — boss encounter" },
  { value: "web_matron", label: "web_matron — boss encounter" },
  { value: "frostcrab", label: "frostcrab — boss encounter" },
  { value: "snapjaw_guard", label: "snapjaw_guard — boss encounter" },
  { value: "frostcrab_guard", label: "frostcrab_guard — boss encounter" },
  { value: "shellback_titan", label: "shellback_titan — boss encounter" },
  { value: "carrion_chorus", label: "carrion_chorus — boss encounter" },
  { value: "viking_warrior", label: "viking_warrior — talkable, sail offer" },
  { value: "viking_warrior_landing", label: "viking_warrior_landing — talkable, sail offer" },
  { value: "viking_warrior_boss", label: "viking_warrior_boss — boss encounter" },
  { value: "viking_sentinel", label: "viking_sentinel — blocks its tile, cannot be talked to" },
  { value: "Captain_Return", label: "Captain_Return — talkable, sail offer" },
  { value: "Mystic_Tomb", label: "Mystic_Tomb — talkable" },
  { value: "Tomb_Door_L", label: "Tomb_Door_L — blocks its tile, cannot be talked to" },
  { value: "Tomb_Door_R", label: "Tomb_Door_R — blocks its tile, cannot be talked to" },
  { value: "Hall_Door_Boarded", label: "Hall_Door_Boarded — talkable" },
  { value: "Tomb_Evil", label: "Tomb_Evil — boss encounter" },
  { value: "Wisp", label: "Wisp — the Wisp, appears on her own" },
  { value: "Wisp_Orb", label: "Wisp_Orb — the Wisp, appears on her own" },
  { value: "mock_walker", label: "mock_walker — talkable" },
  { value: "Prospector", label: "Prospector — talkable" },
  { value: "cinder_hound", label: "cinder_hound — boss encounter" },
  { value: "ashwing", label: "ashwing — boss encounter" },
  { value: "cinder_hound_guard", label: "cinder_hound_guard — boss encounter" },
  { value: "ashwing_guard", label: "ashwing_guard — boss encounter" },
  { value: "Mine_Gate", label: "Mine_Gate — talkable" },
  { value: "Rubble", label: "Rubble — object, shattered with the icebreaker pick" },
  { value: "Hunter", label: "Hunter — talkable" },
  { value: "carrion_chorus_guard", label: "carrion_chorus_guard — boss encounter" },
  { value: "web_matron_guard", label: "web_matron_guard — boss encounter" },
  { value: "Bramble", label: "Bramble — object, shattered with the icebreaker pick" },
  { value: "fen_log", label: "fen_log — object, pushed by walking into it" },
];
