import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function isOrganizationAdmin(userId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, role: "ADMIN" },
    select: { userId: true },
  });
  return membership !== null;
}

export async function isCurrentUserAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && user ? isOrganizationAdmin(user.id) : false;
}

export async function getCurrentAdminId() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !(await isOrganizationAdmin(user.id))) return null;
  return user.id;
}
