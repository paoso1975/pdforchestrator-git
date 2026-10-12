import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchCreateSchema, batchResponseSchema, uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const organizationId = uuidSchema.parse(request.nextUrl.searchParams.get("organizationId"));
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership) return forbidden();
    const batches = await prisma.batch.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" } });
    return NextResponse.json(batchResponseSchema.array().parse(batches));
  } catch (error) {
    return validationError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const body = batchCreateSchema.parse(await request.json());
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: body.organizationId, userId } } });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();
    const batch = await prisma.batch.create({ data: {
      organizationId: body.organizationId,
      name: body.name,
      slug: body.slug,
      description: body.description,
    } });
    return NextResponse.json(batchResponseSchema.parse(batch), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Esiste già un batch con questo slug nell'organizzazione." }, { status: 409 });
    }
    return validationError(error);
  }
}
