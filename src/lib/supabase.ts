import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  throw new Error("VITE_SUPABASE_URL must be a valid Supabase project URL");
}

if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname))) {
  throw new Error("VITE_SUPABASE_URL must use HTTPS (HTTP is allowed for local development)");
}

function tokenRole(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4))) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

if (supabaseKey.startsWith("sb_secret_") || tokenRole(supabaseKey) === "service_role") {
  throw new Error("A Supabase secret or service-role key cannot be used in frontend code");
}
if (!supabaseKey.startsWith("sb_publishable_") && !["anon", "authenticated"].includes(tokenRole(supabaseKey) ?? "")) {
  throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable or legacy anon key");
}

export const supabase = createClient<Database>(parsedUrl.origin, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});