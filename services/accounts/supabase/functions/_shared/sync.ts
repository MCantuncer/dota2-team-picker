import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchPlayer } from "./opendota.ts";
import { steamIdToAccountId } from "./steam.ts";

/**
 * Copies a Steam user's rank, name, picture and per-hero record from
 * OpenDota into their profile. Needs a service role client, because users
 * cannot write these fields themselves.
 */
export async function syncProfile(admin: SupabaseClient, userId: string, steamId: string, fetchFn: typeof fetch = fetch) {
  const player = await fetchPlayer(steamIdToAccountId(steamId), fetchFn);

  const { data: current, error: readError } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  if (readError) throw readError;

  const update: Record<string, unknown> = {
    rank_tier: player.rankTier,
    hero_stats: player.heroStats,
    synced_at: new Date().toISOString(),
  };
  if (player.avatarUrl) update.avatar_url = player.avatarUrl;
  // New Steam users start with their SteamID as name; keep any name they chose.
  if (player.name && current.display_name === steamId) update.display_name = player.name.slice(0, 40);

  const { data, error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", userId)
    .select("display_name, avatar_url, rank_tier, synced_at")
    .single();
  if (error) throw error;
  return data;
}
