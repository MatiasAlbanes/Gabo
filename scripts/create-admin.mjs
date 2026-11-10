// Crea (o actualiza) un usuario administrador en Supabase Auth y lo autoriza en `admin_users`.
//   npm run create-admin -- gabo@ejemplo.com "UnaContraseñaLarga"
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (se leen de .env.local o del entorno).
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const [email, password, role = "owner"] = process.argv.slice(2);
if (!email || !password) {
  console.error('Uso: npm run create-admin -- <email> "<contraseña>" [owner|admin]');
  process.exit(1);
}
if (password.length < 10) {
  console.error("La contraseña debe tener al menos 10 caracteres.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
let userId;
const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  if (!/already|registered|exists/i.test(created.error.message)) throw created.error;
  const list = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw new Error("El usuario existe pero no pudo encontrarse.");
  userId = existing.id;
  await sb.auth.admin.updateUserById(userId, { password });
  console.log("Usuario existente: contraseña actualizada.");
} else {
  userId = created.data.user.id;
  console.log("Usuario creado.");
}
const { error } = await sb.from("admin_users").upsert({ user_id: userId, role });
if (error) throw error;
console.log(`✔ ${email} autorizado como ${role}.`);
