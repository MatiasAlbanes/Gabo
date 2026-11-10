import "server-only";
/** Reloj del servidor (aislado para poder fijarlo en pruebas y evitar llamadas impuras en páginas). */
export const nowMs = (): number => Date.now();
