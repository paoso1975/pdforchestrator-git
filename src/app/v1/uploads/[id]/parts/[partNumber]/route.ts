import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; partNumber: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const params = await context.params; const id = z.string().uuid().parse(params.id); const partNumber = z.coerce.number().int().min(1).max(10000).parse(params.partNumber);
    const file = await prisma.storedFile.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id, kind: "INPUT", uploadState: "MULTIPART", uploadId: { not: null }, expiresAt: { gt: new Date() } } });
    if (!file?.uploadId) return NextResponse.json({ error: "Sessione multipart non valida o scaduta." }, { status: 404 });
    const maxParts = Math.ceil(Number(file.sizeBytes) / (8 * 1024 * 1024)); if (partNumber > maxParts) return NextResponse.json({ error: "Numero parte oltre la dimensione dell'upload." }, { status: 400 });
    const url = await getSignedUrl(createStorageClient(), new UploadPartCommand({ Bucket: file.bucket, Key: file.objectKey, UploadId: file.uploadId, PartNumber: partNumber }), { expiresIn: 600 });
    return NextResponse.json({ partNumber, uploadUrl: url, method: "PUT", expiresIn: 600 });
  } catch (error) { return publicApiError(error, request); }
}
