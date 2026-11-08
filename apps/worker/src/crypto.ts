const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error("invalid hex");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

function decodeKey(base64: string, label: string): Uint8Array {
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error(`${label} must be 32 bytes, base64-encoded`);
  return raw;
}

export async function importHmacKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeKey(base64, "SESSION_SECRET"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function importAesKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeKey(base64, "TOKEN_ENCRYPTION_KEY"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function hmacHex(key: CryptoKey, data: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

export async function hmacVerify(key: CryptoKey, data: string, signatureHex: string): Promise<boolean> {
  let signature: Uint8Array;
  try {
    signature = fromHex(signatureHex);
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(data));
}

// The workspace id is bound in as associated data, so a ciphertext copied to another row won't decrypt.
export async function encryptToHex(key: CryptoKey, plaintext: string, associatedData: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) }, key, encoder.encode(plaintext)),
  );
  return toHex(iv) + toHex(ct);
}

export async function decryptFromHex(key: CryptoKey, hex: string, associatedData: string): Promise<string> {
  const bytes = fromHex(hex);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(associatedData) },
    key,
    bytes.slice(12),
  );
  return new TextDecoder().decode(pt);
}
