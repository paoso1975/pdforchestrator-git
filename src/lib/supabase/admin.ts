import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurare SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
