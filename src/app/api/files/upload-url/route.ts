import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { createStorageClient, getStorageConfig } from "@/lib/storage";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";
const schema = z.object({ organizationId: z.string().uuid(), filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive().max(100 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const body = schema.parse(await request.json());
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: body.organizationId, userId } } });
    if (!membership || !["OWNER", "ADMIN", "OPERATOR", "DESIGNER"].includes(membership.role)) return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    const { bucket } = getStorageConfig();
    const id = randomUUID();
    const safeName = body.filename.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120) || "input.pdf";
    const objectKey = `${body.organizationId}/inputs/${id}/${safeName}`;
    const file = await prisma.storedFile.create({ data: { id, organizationId: body.organizationId, bucket, objectKey, filename: body.filename, mimeType: "application/pdf", sizeBytes: BigInt(body.sizeBytes), sha256: body.sha256.toLowerCase(), kind: "INPUT" } });
    const uploadUrl = await getSignedUrl(createStorageClient(), new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: "application/pdf", ContentLength: body.sizeBytes, Metadata: { "pfo-file-id": file.id } }), { expiresIn: 600 });
    return NextResponse.json({ fileId: file.id, uploadUrl, method: "PUT", headers: { "content-type": "application/pdf", "x-amz-meta-pfo-file-id": file.id }, expiresIn: 600, browserDirectUploadSupported: false }, { status: 201 });
  } catch (error) { return validationError(error); }
}
