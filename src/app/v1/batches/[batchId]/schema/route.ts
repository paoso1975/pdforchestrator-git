import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
import { publicBatchSlugSchema } from "@/lib/public-api-security";
export const runtime = "nodejs";
type Context = { params: Promise<{ batchId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const selector = (await context.params).batchId;
    const isId = z.string().uuid().safeParse(selector).success;
    if (!isId) publicBatchSlugSchema.parse(selector);
    const url = new URL(request.url);
    const requestedVersionId = url.searchParams.has("versionId") ? z.string().uuid().parse(url.searchParams.get("versionId")) : null;
    const batch = await prisma.batch.findFirst({ where: { ...(isId ? { id: selector } : { slug: selector }), organizationId: auth.credential.organizationId, status: "PUBLISHED" }, select: { id: true, name: true, activeVersionId: true } });
    if (!batch) return NextResponse.json({ error: "Batch non trovato o non autorizzato." }, { status: 404 });
    const batchId = batch.id;
    const versionId = requestedVersionId ?? batch.activeVersionId;
    const version = versionId ? await prisma.batchVersion.findFirst({ where: { id: versionId, batchId, publishedAt: { not: null } } }) : null;
    if (!version || !await credentialCanAccessBatchVersion(auth.credential.id, batchId, version.id)) return NextResponse.json({ error: "Batch non trovato o non autorizzato per questa versione." }, { status: 404 });
    return NextResponse.json({ batchId, name: batch.name, version: version.version, versionId: version.id, configHash: version.configHash, inputSchema: version.inputSchema, outputSchema: version.outputSchema, publishedAt: version.publishedAt });
  } catch (error) { return publicApiError(error, request); }
}
