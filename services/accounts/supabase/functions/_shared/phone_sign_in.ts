/** A phone sign-in code as create_phone_sign_in makes it: 24 random bytes, url-safe base64 without padding. */
const CODE = /^[A-Za-z0-9_-]{32}$/;

/** The code from the /follow page's form, or null when it is missing or not a code. */
export async function readCode(req: Request): Promise<string | null> {
  if (req.method !== "POST") return null;
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return null;
  const form = await req.text().then((t) => new URLSearchParams(t)).catch(() => null);
  const code = form?.get("code") ?? null;
  return code && CODE.test(code) ? code : null;
}
