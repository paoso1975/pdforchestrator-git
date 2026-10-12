import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { verifyStoredPdfUpload } from "@/lib/upload-verification";
import { authorizePublicRequest, publicApiError, readBody } from "@/lib/public-api";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) }).strict()).min(1).max(10000) }).strict();
export async function POST(request: Request, context: Context) {
  try {
    const { bytes, error } = await readBody(request); if (error) return error;
    const auth = await authorizePublicRequest(request, bytes); if (auth.response) return auth.response;
    const id = z.string().uuid().parse((await context.params).id); const body = bodySchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    const partNumbers = body.parts.map((p) => p.partNumber); if (new Set(partNumbers).size !== partNumbers.length || partNumbers.some((n, i) => n !== i + 1)) return NextResponse.json({ error: "Le parti devono essere univoche e numerate da 1 in ordine." }, { status: 400 });
    const file = await prisma.storedFile.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id, kind: "INPUT", uploadState: "MULTIPART", uploadId: { not: null }, expiresAt: { gt: new Date() } } });
    if (!file?.uploadId) return NextResponse.json({ error: "Sessione multipart non valida." }, { status: 404 });
    const storage = createStorageClient();
    await storage.send(new CompleteMultipartUploadCommand({ Bucket: file.bucket, Key: file.objectKey, UploadId: file.uploadId, MultipartUpload: { Parts: body.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) } }));
    const verification = await verifyStoredPdfUpload(storage, file);
    if (!verification.valid) { await prisma.storedFile.update({ where: { id }, data: { uploadState: "INVALID", uploadId: null } }); return NextResponse.json({ error: "Upload rifiutato: dimensione, MIME, riferimento o firma PDF non valida.", reason: verification.reason }, { status: 409 }); }
    await prisma.storedFile.update({ where: { id }, data: { uploadState: "UPLOADED", uploadId: null } });
    return NextResponse.json({ id, state: "UPLOADED", sizeBytes: verification.sizeBytes, expectedSha256: file.sha256, checksumVerifiedByWorker: true });
  } catch (error) { return publicApiError(error, request); }
}
