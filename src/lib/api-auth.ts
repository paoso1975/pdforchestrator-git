import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user?.id ?? null;
}
