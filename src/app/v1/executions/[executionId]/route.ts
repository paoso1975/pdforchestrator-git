import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizePublicRequest, publicApiError } from "@/lib/public-api";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizePublicRequest(request, new Uint8Array()); if (auth.response) return auth.response;
    const id = z.string().uuid().parse((await context.params).executionId);
    const execution = await prisma.batchExecution.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id }, select: { id: true, batchId: true, batchVersionId: true, status: true, progress: true, currentStepId: true, pagesProcessed: true, durationMs: true, input: true, output: true, error: true, createdAt: true, startedAt: true, completedAt: true } });
    if (!execution) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    if (!await credentialCanAccessBatchVersion(auth.credential.id, execution.batchId, execution.batchVersionId)) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    return NextResponse.json(execution);
  } catch (error) { return publicApiError(error, request); }
}
