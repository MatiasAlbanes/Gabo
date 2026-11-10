import type { Metadata } from "next";
import Link from "next/link";
import { anonClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Política de privacidad" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const { data } = await anonClient().from("business_settings").select("name,whatsapp,instagram_url").eq("id", 1).single();
  const name = data?.name ?? "Don Gabo Barber Studio";
  return (
    <main className="mx-auto max-w-lg px-5 py-10 text-[15px] leading-relaxed text-neutral-700">
      <Link href="/" className="text-sm underline">
        ← Volver a reservar
      </Link>
      <h1 className="mb-6 mt-4 font-display text-4xl font-semibold uppercase tracking-wide text-neutral-950">Política de privacidad</h1>

      <h2 className="mt-6 font-semibold text-neutral-950">Qué datos pedimos</h2>
      <p>Solo tu nombre y tu número de WhatsApp, junto con el servicio, el día y la hora del turno que elegís. No pedimos correo electrónico, DNI ni contraseñas, y no creás ninguna cuenta.</p>

      <h2 className="mt-6 font-semibold text-neutral-950">Para qué los usamos</h2>
      <p>Únicamente para gestionar tu turno en {name}: confirmarlo, avisarte si hay cambios y contactarte por WhatsApp si hace falta. No los vendemos, no los usamos para publicidad de terceros y no los compartimos con otras personas.</p>

      <h2 className="mt-6 font-semibold text-neutral-950">Quién puede verlos</h2>
      <p>Solo el personal autorizado de {name}. Otras personas que reservan nunca ven tu nombre ni tu teléfono: la página solo muestra qué horarios están libres. Tu turno se gestiona con un enlace privado e imposible de adivinar; cualquier persona que tenga ese enlace puede ver y modificar el turno, por eso conviene no compartirlo.</p>

      <h2 className="mt-6 font-semibold text-neutral-950">Cuánto tiempo los conservamos</h2>
      <p>Mantenemos el historial de turnos mientras sea necesario para organizar la agenda del local. Podés pedir que eliminemos tus datos en cualquier momento.</p>

      <h2 className="mt-6 font-semibold text-neutral-950">Tus derechos</h2>
      <p>Podés acceder, rectificar o solicitar la supresión de tus datos personales (Ley 25.326 de Protección de Datos Personales de Argentina). Escribinos{data?.whatsapp ? " por WhatsApp" : " por Instagram"} y lo resolvemos.</p>

      <h2 className="mt-6 font-semibold text-neutral-950">Cookies</h2>
      <p>La página de reservas no usa cookies de seguimiento. Solo el panel privado del local usa cookies técnicas para mantener la sesión iniciada.</p>
    </main>
  );
}
