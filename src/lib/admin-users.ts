import "server-only";
import type { User } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import type { ManagedUser } from "@/lib/types/users";

export function toManagedUser(user: User): ManagedUser {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "",
    role: typeof user.app_metadata?.role === "string" ? user.app_metadata.role : "user",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  };
}

export async function syncProfile(user: User) {
  const profile = toManagedUser(user);
  return prisma.$transaction(async (tx) => {
    if (profile.email) {
      const existingEmail = await tx.userProfile.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });

      // UserProfile is a mirror of Supabase Auth. An old row can retain an
      // email after the Auth account was recreated with a different UUID.
      // Remove that orphan before the upsert so the unique email index cannot
      // reject the current Auth identity.
      if (existingEmail && existingEmail.id !== profile.id) {
        await tx.userProfile.deleteMany({ where: { id: existingEmail.id } });
      }
    }

    return tx.userProfile.upsert({
      where: { id: profile.id },
      create: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
        createdAt: new Date(profile.createdAt),
      },
      update: {
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      },
    });
  });
}
