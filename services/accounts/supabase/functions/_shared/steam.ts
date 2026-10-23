/**
 * Sign in through Steam (OpenID 2.0).
 *
 * Steam sends the user back to our callback with a signed assertion. We ask
 * Steam to confirm the signature (check_authentication) instead of checking
 * it ourselves, so there is no key to keep.
 */

export const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
/** SteamID64 of account id 0; account id = SteamID64 - this. */
const STEAM_ID_BASE = 76561197960265728n;

/** The Steam page that asks the user to sign in and sends them to `returnTo`. */
export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${params}`;
}

/**
 * Checks the assertion Steam sent to our callback and returns the user's
 * SteamID64, or null if it is not genuine or was meant for another URL.
 */
export async function verifySteamLogin(
  callback: URL,
  expectedReturnTo: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const query = callback.searchParams;
  if (query.get("openid.mode") !== "id_res") return null;
  if (query.get("openid.op_endpoint") !== STEAM_OPENID) return null;
  const returnTo = query.get("openid.return_to") ?? "";
  if (returnTo !== expectedReturnTo) return null;
  const match = CLAIMED_ID.exec(query.get("openid.claimed_id") ?? "");
  if (!match || query.get("openid.identity") !== query.get("openid.claimed_id")) return null;

  const body = new URLSearchParams();
  for (const [key, value] of query) {
    if (key.startsWith("openid.")) body.set(key, value);
  }
  body.set("openid.mode", "check_authentication");
  const res = await fetchFn(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const valid = (await res.text()).split("\n").some((line) => line.trim() === "is_valid:true");
  return valid ? match[1]! : null;
}

/** OpenDota and Dota use the 32-bit account id, not the SteamID64. */
export function steamIdToAccountId(steamId: string): number {
  return Number(BigInt(steamId) - STEAM_ID_BASE);
}

/** Users who signed in with Steam have this placeholder email and no other way to sign in. */
export function isSteamOnlyEmail(email: string | undefined): boolean {
  return !email || email.endsWith("@steam.invalid");
}

/** True for a picture served by Steam, which the profile sync copies from OpenDota. */
export function isSteamAvatar(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "steamstatic.com" || host.endsWith(".steamstatic.com") || host === "steamcdn-a.akamaihd.net";
  } catch {
    return false;
  }
}
