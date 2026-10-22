import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

const schema = z.object({
  fileId: z.string().uuid(),
  requestId: z.string().uuid(),
  phase: z.enum(["PUT_REJECTED", "PUT_NETWORK_ERROR"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  storageCode: z.string().max(120).optional(),
  storageMessage: z.string().max(500).optional(),
  storageRequestId: z.string().max(200).optional(),
}).strict();

function safeText(value: string | undefined) {
  return value?.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });

    const body = schema.parse(await request.json());
    const file = await prisma.storedFile.findUnique({
      where: { id: body.fileId },
      select: { id: true, organizationId: true, filename: true, kind: true },
    });
    if (!file || file.kind !== "INPUT") return NextResponse.json({ error: "Upload non trovato." }, { status: 404 });

    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: file.organizationId, userId } },
      select: { role: true },
    });
    if (!membership || !["OWNER", "ADMIN", "OPERATOR", "DESIGNER"].includes(membership.role)) {
      return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    }

    // This endpoint receives only sanitized failure details. Never accept or log
    // the presigned URL, authorization headers, file body, or signing material.
    console.warn("Cubbit browser upload failed", {
      requestId: body.requestId,
      fileId: file.id,
      organizationId: file.organizationId,
      filename: safeText(file.filename),
      phase: body.phase,
      httpStatus: body.httpStatus,
      storageCode: safeText(body.storageCode),
      storageMessage: safeText(body.storageMessage),
      storageRequestId: safeText(body.storageRequestId),
    });

    return NextResponse.json({ recorded: true });
  } catch (error) {
    return validationError(error);
  }
}
