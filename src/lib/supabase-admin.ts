import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) {
    console.error("[SUPABASE_ADMIN] NEXT_PUBLIC_SUPABASE_URL ausente ou vazia — Supabase indisponivel");
    return null;
  }
  if (!key) {
    console.error("[SUPABASE_ADMIN] SUPABASE_SERVICE_ROLE_KEY ausente ou vazia — Supabase indisponivel");
    return null;
  }

  try {
    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return _client;
  } catch (err) {
    console.error("[SUPABASE_ADMIN] falha ao criar client:", err instanceof Error ? err.message : err);
    return null;
  }
}
