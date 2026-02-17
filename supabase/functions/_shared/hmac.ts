// Deno/Edge compatible HMAC SHA256 (Binance signing)
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sigBuf);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
