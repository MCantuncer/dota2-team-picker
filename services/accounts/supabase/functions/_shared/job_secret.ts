/**
 * Checks the shared secret pg_cron sends to a job function (X-Job-Secret). Compares in
 * constant time, by SHA-256 digests, so the answer time gives nothing away.
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
