import { assertEquals } from "jsr:@std/assert@1";
import { readCode } from "./phone_sign_in.ts";

const CODE = "abcDEF123_-abcDEF123_-abcDEF1234";
const form = (body: string, method = "POST", type = "application/x-www-form-urlencoded") =>
  new Request("https://ref.supabase.co/functions/v1/phone-sign-in", { method, body: method === "GET" ? undefined : body, headers: { "content-type": type } });

Deno.test("reads the code from the form", async () => {
  assertEquals(await readCode(form(`code=${CODE}`)), CODE);
});

Deno.test("a code only comes in a POSTed form", async () => {
  assertEquals(await readCode(form("", "GET")), null);
  assertEquals(await readCode(form(JSON.stringify({ code: CODE }), "POST", "application/json")), null);
});

Deno.test("anything that is not a code is refused", async () => {
  assertEquals(await readCode(form("code=short")), null);
  assertEquals(await readCode(form(`code=${CODE}x`)), null);
  assertEquals(await readCode(form(`code=${CODE.slice(0, 31)}%27`)), null);
  assertEquals(await readCode(form("")), null);
});
