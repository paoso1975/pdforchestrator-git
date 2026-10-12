import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchResponseSchema, batchUpdateSchema, uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ batchId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, organization: { memberships: { some: { userId } } } },
      include: { activeVersion: true, versions: { orderBy: { version: "desc" } } },
    });
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    return NextResponse.json(batchResponseSchema.parse(batch));
  } catch (error) {
    return validationError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const body = batchUpdateSchema.parse(await request.json());
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, organization: { memberships: { some: { userId } } } },
      select: { id: true, organizationId: true, updatedAt: true },
    });
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: batch.organizationId, userId } } });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();
    const expectedUpdatedAt = request.headers.get("if-match")?.match(/^"(.+)"$/)?.[1];
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return NextResponse.json({ error: "Precondizione If-Match con updatedAt ISO tra virgolette richiesta.", updatedAt: batch.updatedAt }, { status: 428 });
    }
    const expectedDate = new Date(expectedUpdatedAt);
    const write = await prisma.batch.updateMany({ where: { id: batchId, organizationId: batch.organizationId, updatedAt: expectedDate }, data: body });
    if (write.count === 0) return NextResponse.json({ error: "Il batch è stato modificato da un'altra sessione. Ricarica la versione più recente.", updatedAt: batch.updatedAt }, { status: 412 });
    const updated = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    return NextResponse.json(batchResponseSchema.parse(updated));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Esiste già un batch con questo slug nell'organizzazione." }, { status: 409 });
    }
    return validationError(error);
  }
}
