import { assertEquals } from "jsr:@std/assert@1";
import { STEAM_OPENID, steamIdToAccountId, steamLoginUrl, verifySteamLogin } from "./steam.ts";

const RETURN_TO = "https://ref.supabase.co/functions/v1/steam-login/callback?next=%2Fprofile";
const STEAM_ID = "76561198047011640";

function callbackUrl(overrides: Record<string, string> = {}): URL {
  const params = new URLSearchParams({
    next: "/profile",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": RETURN_TO,
    "openid.response_nonce": "2026-10-22T14:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  });
  return new URL(`${RETURN_TO.split("?")[0]}?${params}`);
}

function steamSays(answer: string) {
  const calls: URLSearchParams[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    calls.push(new URLSearchParams(init?.body as URLSearchParams));
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${answer}\n`);
  }) as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("login url asks Steam to return to our callback", () => {
  const url = new URL(steamLoginUrl(RETURN_TO, "https://ref.supabase.co"));
  assertEquals(url.origin + url.pathname, STEAM_OPENID);
  assertEquals(url.searchParams.get("openid.return_to"), RETURN_TO);
  assertEquals(url.searchParams.get("openid.realm"), "https://ref.supabase.co");
  assertEquals(url.searchParams.get("openid.mode"), "checkid_setup");
});

Deno.test("accepts an assertion Steam confirms", async () => {
  const steam = steamSays("true");
  assertEquals(await verifySteamLogin(callbackUrl(), RETURN_TO, steam.fetchFn), STEAM_ID);
  assertEquals(steam.calls[0]!.get("openid.mode"), "check_authentication");
  assertEquals(steam.calls[0]!.get("openid.sig"), "c2lnbmF0dXJl");
  assertEquals(steam.calls[0]!.has("next"), false);
});

Deno.test("rejects an assertion Steam does not confirm", async () => {
  assertEquals(await verifySteamLogin(callbackUrl(), RETURN_TO, steamSays("false").fetchFn), null);
});

Deno.test("rejects assertions meant for another site or from another provider", async () => {
  const steam = steamSays("true");
  const cases: Record<string, string>[] = [
    { "openid.return_to": "https://evil.example/callback" },
    { "openid.op_endpoint": "https://evil.example/openid/login" },
    { "openid.claimed_id": "https://evil.example/openid/id/76561198047011640" },
    { "openid.identity": "https://steamcommunity.com/openid/id/76561197960265729" },
    { "openid.mode": "cancel" },
  ];
  for (const overrides of cases) {
    assertEquals(await verifySteamLogin(callbackUrl(overrides), RETURN_TO, steam.fetchFn), null);
  }
  assertEquals(steam.calls.length, 0);
});

Deno.test("converts SteamID64 to account id", () => {
  assertEquals(steamIdToAccountId(STEAM_ID), 86745912);
});
