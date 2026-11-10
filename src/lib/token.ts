import { createHash, randomBytes } from "node:crypto";

/** Token privado de 256 bits (base64url). Se entrega al cliente; en la base solo se guarda su hash. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
