"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";
import { Button, Field, Notice, TextInput } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-8 space-y-4">
      <Field label="Correo electrónico" htmlFor="email">
        <TextInput id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Contraseña" htmlFor="password">
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <Button type="submit" className="w-full" loading={pending}>
        Ingresar
      </Button>
    </form>
  );
}
