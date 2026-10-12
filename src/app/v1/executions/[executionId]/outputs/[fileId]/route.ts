import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string; fileId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const { executionId, fileId } = await context.params; const id = z.string().uuid().parse(executionId); const fileUuid = z.string().uuid().parse(fileId);
    const execution = await prisma.batchExecution.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id }, select: { organizationId: true, batchId: true, batchVersionId: true } });
    if (!execution) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    if (!await credentialCanAccessBatchVersion(auth.credential.id, execution.batchId, execution.batchVersionId)) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    const file = await prisma.storedFile.findFirst({ where: { id: fileUuid, organizationId: execution.organizationId, kind: "OUTPUT", objectKey: { startsWith: `${execution.organizationId}/executions/${id}/` } } });
    if (!file) return NextResponse.json({ error: "Output non trovato." }, { status: 404 });
    const safeFilename = file.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "output.pdf";
    const url = await getSignedUrl(createStorageClient(), new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey, ResponseContentType: file.mimeType, ResponseContentDisposition: `attachment; filename=\"${safeFilename}\"` }), { expiresIn: 300 });
    return NextResponse.json({ id: file.id, filename: file.filename, mimeType: file.mimeType, downloadUrl: url, expiresIn: 300, sha256: file.sha256, sizeBytes: file.sizeBytes.toString() });
  } catch (error) { return publicApiError(error, request); }
}
