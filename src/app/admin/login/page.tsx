import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/server/admin";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center px-5">
      <h1 className="font-display uppercase leading-[0.95]">
        <span className="block text-4xl font-bold tracking-[0.08em]">Don Gabo</span>
        <span className="block text-base font-medium tracking-[0.42em] text-neutral-500">Panel privado</span>
      </h1>
      <LoginForm />
    </main>
  );
}
