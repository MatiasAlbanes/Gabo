import "server-only";
import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { AppError } from "./errors";

/** Devuelve el usuario administrador actual o null. Verifica sesión Y fila en admin_users. */
export async function getAdmin() {
  const sb = await sessionClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: row } = await sb.from("admin_users").select("role").eq("user_id", data.user.id).maybeSingle();
  if (!row) return null;
  return { sb, user: data.user, role: row.role as "owner" | "admin" };
}

/** Para páginas: redirige al login si no es administrador. */
export async function requireAdminPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** Para acciones de servidor: lanza si no es administrador. */
export async function requireAdminAction() {
  const admin = await getAdmin();
  if (!admin) throw new AppError("unauthorized");
  return admin;
}
