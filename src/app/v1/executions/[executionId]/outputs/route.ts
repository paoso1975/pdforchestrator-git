import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const id = z.string().uuid().parse((await context.params).executionId);
    const execution = await prisma.batchExecution.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id }, select: { id: true, organizationId: true, batchId: true, batchVersionId: true } });
    if (!execution) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    if (!await credentialCanAccessBatchVersion(auth.credential.id, execution.batchId, execution.batchVersionId)) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    const files = await prisma.storedFile.findMany({ where: { organizationId: execution.organizationId, kind: "OUTPUT", objectKey: { startsWith: `${execution.organizationId}/executions/${id}/` } }, orderBy: { createdAt: "asc" } });
    const storage = createStorageClient();
    return NextResponse.json(await Promise.all(files.map(async (file) => {
      const safeFilename = file.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "output.pdf";
      return { id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString(), sha256: file.sha256, downloadUrl: await getSignedUrl(storage, new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey, ResponseContentType: file.mimeType, ResponseContentDisposition: `attachment; filename=\"${safeFilename}\"` }), { expiresIn: 300 }), expiresIn: 300 };
    })));
  } catch (error) { return publicApiError(error, request); }
}
