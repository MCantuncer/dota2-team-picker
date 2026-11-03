import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { postStratz } from "./stratz.ts";

const answering = (status: number, body: unknown) => {
  const sent: RequestInit[] = [];
  const fetchFn = ((_url: string, init?: RequestInit) => {
    if (init) sent.push(init);
    return Promise.resolve(Response.json(body, { status }));
  }) as typeof fetch;
  return { fetchFn, sent };
};

Deno.test("returns the data and sends the token and STRATZ user agent", async () => {
  const api = answering(200, { data: { ok: 1 } });
  assertEquals(await postStratz("t0k", "{ ok }", 1000, api.fetchFn), { ok: 1 });
  const headers = api.sent[0]!.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer t0k");
  assertEquals(headers["User-Agent"], "STRATZ_API");
});

Deno.test("throws on HTTP errors, GraphQL errors and empty data", async () => {
  await assertRejects(() => postStratz("t", "q", 1000, answering(403, {}).fetchFn), Error, "HTTP 403");
  await assertRejects(
    () => postStratz("t", "q", 1000, answering(200, { data: null, errors: [{ message: "bad" }] }).fetchFn),
    Error,
    "bad",
  );
  await assertRejects(() => postStratz("t", "q", 1000, answering(200, {}).fetchFn), Error, "HTTP 200");
});
