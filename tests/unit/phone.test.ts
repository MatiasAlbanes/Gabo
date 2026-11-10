import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { generateToken, hashToken, TOKEN_PATTERN } from "@/lib/token";
import { waLink } from "@/lib/whatsapp";

describe("teléfonos argentinos", () => {
  it.each([
    ["261 5123456", "+5492615123456"],
    ["0261 15 5123456", "+5492615123456"],
    ["+54 9 261 512 3456", "+5492615123456"],
    ["5492615123456", "+5492615123456"],
    ["11 2345-6789", "+5491123456789"],
  ])("normaliza %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(["", "123", "abc", "261 51", "0000000000"])("rechaza %j", (input) => expect(normalizePhone(input)).toBeNull());

  it("acepta números internacionales válidos", () => expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671"));

  it("arma enlaces de WhatsApp sin '+'", () => {
    expect(waLink("+5492615123456")).toBe("https://wa.me/5492615123456");
    expect(waLink("+5492615123456", "Hola & chau")).toBe("https://wa.me/5492615123456?text=Hola%20%26%20chau");
  });
});

describe("tokens privados", () => {
  it("son largos, únicos y no predecibles", () => {
    const set = new Set(Array.from({ length: 500 }, generateToken));
    expect(set.size).toBe(500);
    for (const t of set) expect(t).toMatch(TOKEN_PATTERN);
  });
  it("el hash es determinista y no revela el token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64);
  });
});
