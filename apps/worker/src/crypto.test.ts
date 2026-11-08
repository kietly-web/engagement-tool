import { describe, expect, it } from "vitest";
import { decryptFromHex, encryptToHex, fromBase64Url, hmacHex, hmacVerify, importAesKey, importHmacKey, randomToken, toBase64Url } from "./crypto";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("crypto helpers", () => {
  it("round-trips base64url", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
  });

  it("makes unguessable distinct tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it("encrypts with AES-GCM bound to associated data", async () => {
    const key = await importAesKey(KEY);
    const hex = await encryptToHex(key, "1//refresh-token", "workspace-a");
    expect(hex).not.toContain(Buffer.from("refresh").toString("hex"));
    expect(await decryptFromHex(key, hex, "workspace-a")).toBe("1//refresh-token");
    await expect(decryptFromHex(key, hex, "workspace-b")).rejects.toThrow();
    const tampered = hex.slice(0, -2) + (hex.endsWith("00") ? "01" : "00");
    await expect(decryptFromHex(key, tampered, "workspace-a")).rejects.toThrow();
    expect(hex.startsWith("01")).toBe(true);
    await expect(decryptFromHex(key, `02${hex.slice(2)}`, "workspace-a")).rejects.toThrow(/key version/);
  });

  it("verifies HMAC signatures and rejects garbage", async () => {
    const key = await importHmacKey(KEY);
    const sig = await hmacHex(key, "payload");
    expect(await hmacVerify(key, "payload", sig)).toBe(true);
    expect(await hmacVerify(key, "payload2", sig)).toBe(false);
    expect(await hmacVerify(key, "payload", "zz")).toBe(false);
  });

  it("rejects keys of the wrong length", async () => {
    await expect(importAesKey(btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});
