import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Sin caché incremental: todas las páginas son dinámicas (datos siempre frescos desde Supabase).
export default defineCloudflareConfig();
