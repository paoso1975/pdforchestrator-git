import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { getAccessibleOrganizations } from "@/lib/organizations";
import { organizationCreateSchema, organizationResponseSchema } from "@/lib/schemas/api";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { unauthorized, validationError } from "@/lib/validation";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const organizations = await getAccessibleOrganizations(userId);
    const result = organizations.map(({ memberships, ...organization }) => ({ ...organization, role: memberships[0].role }));
    return NextResponse.json(organizationResponseSchema.array().parse(result));
  } catch (error) {
    return validationError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return unauthorized();
    const body = organizationCreateSchema.parse(await request.json());
    const organization = await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: user.id },
        create: { id: user.id, email: user.email ?? null, displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null },
        update: { email: user.email ?? null, displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null },
      });
      return tx.organization.create({ data: {
        name: body.name,
        slug: body.slug,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      }, select: { id: true, name: true, slug: true, createdAt: true } });
    });
    return NextResponse.json(organizationResponseSchema.parse({ ...organization, role: "OWNER" }), { status: 201 });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      return NextResponse.json({ error: "Questo slug di organizzazione è già utilizzato." }, { status: 409 });
    }
    return validationError(cause);
  }
}
