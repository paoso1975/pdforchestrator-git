import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { uuidSchema } from "@/lib/schemas/api";
import { executionForRequest } from "@/lib/execution-auth";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const id = uuidSchema.parse((await context.params).executionId); const result = await executionForRequest(id, request); if (result.response) return result.response;
    const files = await prisma.storedFile.findMany({ where: { organizationId: result.execution.organizationId, kind: "OUTPUT", objectKey: { startsWith: `${result.execution.organizationId}/executions/${id}/` } }, orderBy: { createdAt: "asc" } });
    const storage = createStorageClient();
    const outputs = await Promise.all(files.map(async (file) => {
      const safeFilename = file.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "output.pdf";
      return { id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString(), sha256: file.sha256, downloadUrl: await getSignedUrl(storage, new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey, ResponseContentType: file.mimeType, ResponseContentDisposition: `attachment; filename="${safeFilename}"` }), { expiresIn: 300 }), expiresIn: 300 };
    }));
    return NextResponse.json(outputs);
  } catch (error) { return validationError(error); }
}
