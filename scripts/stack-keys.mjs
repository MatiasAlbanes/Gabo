// Genera las claves JWT (anon / service_role) del stack local a partir del secreto.
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

export const JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? "local-dev-only-jwt-secret-min-32-characters-long";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 5;
export const ANON_KEY = sign({ role: "anon", iss: "supabase-local", exp });
export const SERVICE_KEY = sign({ role: "service_role", iss: "supabase-local", exp });

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`JWT_SECRET=${JWT_SECRET}\nANON_KEY=${ANON_KEY}\nSERVICE_KEY=${SERVICE_KEY}`);
}
