import "server-only";
import { prisma } from "@/lib/prisma";
import { versionScopeAllows } from "@/lib/public-api-security";

/** An empty version list is the backwards-compatible batch-wide grant. */
export async function credentialCanAccessBatchVersion(credentialId: string, batchId: string, batchVersionId: string): Promise<boolean> {
  const grants = await prisma.apiCredentialGrant.findMany({ where: { credentialId, batchId }, select: { batchVersionIds: true } });
  return grants.some(({ batchVersionIds }) => versionScopeAllows(batchVersionIds, batchVersionId));
}
