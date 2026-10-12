import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { verifyStoredPdfUpload } from "@/lib/upload-verification";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const id = z.string().uuid().parse((await context.params).id);
    const file = await prisma.storedFile.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id, kind: "INPUT" } });
    if (!file) return NextResponse.json({ error: "Upload non trovato." }, { status: 404 });
    try {
      const verification = await verifyStoredPdfUpload(createStorageClient(), file);
      const valid = verification.valid;
      if (valid && file.uploadState !== "UPLOADED") await prisma.storedFile.update({ where: { id }, data: { uploadState: "UPLOADED" } });
      if (!valid && file.uploadState !== "INVALID") await prisma.storedFile.update({ where: { id }, data: { uploadState: "INVALID" } });
      return NextResponse.json({ id, state: valid ? "UPLOADED" : "INVALID", sizeBytes: valid ? verification.sizeBytes : null, contentType: valid ? "application/pdf" : null, expectedSha256: file.sha256, checksumVerifiedByWorker: true, createdAt: file.createdAt });
    } catch { return NextResponse.json({ id, state: "PENDING", expectedSizeBytes: file.sizeBytes.toString() }); }
  } catch (error) { return publicApiError(error, request); }
}
