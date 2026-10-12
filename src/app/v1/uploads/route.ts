import { randomUUID } from "node:crypto";
import { CreateMultipartUploadCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient, getStorageConfig } from "@/lib/storage";
import { authorizePublicRequest, publicApiError, readBody } from "@/lib/public-api";
import { positiveBigIntConfig, positiveIntegerConfig } from "@/lib/public-api-security";

export const runtime = "nodejs";
const maxUploadBytes = positiveIntegerConfig(process.env.PFO_MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
const defaultStorageQuota = BigInt(10 * 1024 * 1024 * 1024);
const schema = z.object({ filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive().max(maxUploadBytes), sha256: z.string().regex(/^[a-f\d]{64}$/i) }).strict();

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const { bytes, error } = await readBody(request); if (error) return error;
    const auth = await authorizePublicRequest(request, bytes); if (auth.response) return auth.response;
    let input: z.infer<typeof schema>; try { input = schema.parse(JSON.parse(new TextDecoder().decode(bytes))); } catch (e) { return publicApiError(e, request); }
    const { bucket } = getStorageConfig(); const id = randomUUID();
    const filename = input.filename.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120) || "input.pdf";
    const objectKey = `${auth.credential.organizationId}/inputs/${id}/${filename}`;
    const quota = positiveBigIntConfig(process.env.PFO_ORG_STORAGE_QUOTA_BYTES, defaultStorageQuota);
    const multipart = input.sizeBytes > 8 * 1024 * 1024;
    const file = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${auth.credential.organizationId}::uuid FOR UPDATE`;
      const used = await tx.storedFile.aggregate({ where: { organizationId: auth.credential.organizationId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _sum: { sizeBytes: true } });
      if ((used._sum.sizeBytes ?? BigInt(0)) + BigInt(input.sizeBytes) > quota) return null;
      return tx.storedFile.create({ data: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id, bucket, objectKey, filename: input.filename, mimeType: "application/pdf", sizeBytes: BigInt(input.sizeBytes), expectedSizeBytes: BigInt(input.sizeBytes), sha256: input.sha256.toLowerCase(), kind: "INPUT", uploadState: multipart ? "MULTIPART" : "PENDING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
    });
    if (!file) return NextResponse.json({ error: "Quota storage organizzativa superata." }, { status: 413 });
    const storage = createStorageClient();
    if (multipart) {
      const created = await storage.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: objectKey, ContentType: "application/pdf", Metadata: { "pfo-file-id": id } }));
      if (!created.UploadId) throw new Error("Il server filesystem non ha restituito un uploadId multipart.");
      await prisma.storedFile.update({ where: { id }, data: { uploadId: created.UploadId } });
      const publicPrefix = new URL(request.url).pathname.startsWith("/api/public/v1/") ? "/api/public/v1" : "/v1";
      return NextResponse.json({ fileId: file.id, state: "MULTIPART", uploadId: created.UploadId, partSizeBytes: 8 * 1024 * 1024, partsUrl: `${publicPrefix}/uploads/${id}/parts/{partNumber}`, completeUrl: `${publicPrefix}/uploads/${id}/complete`, expiresIn: 600, maxBytes: input.sizeBytes, requestId }, { status: 201 });
    }
    const uploadUrl = await getSignedUrl(storage, new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: "application/pdf", ContentLength: input.sizeBytes, Metadata: { "pfo-file-id": id } }), { expiresIn: 600 });
    return NextResponse.json({ fileId: id, state: "PENDING", method: "PUT", uploadUrl, headers: { "content-type": "application/pdf", "x-amz-meta-pfo-file-id": id }, expiresIn: 600, maxBytes: input.sizeBytes, requestId }, { status: 201 });
  } catch (cause) { console.error("public upload initialization failed", { requestId }); return publicApiError(cause, request); }
}
