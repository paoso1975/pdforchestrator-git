import { notFound } from "next/navigation";
import { BatchEditor } from "@/components/batch-editor";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export default async function EditBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId();
  if (!userId) notFound();
  const { id } = await params;
  const batch = await prisma.batch.findFirst({ where: { id, organization: { memberships: { some: { userId } } } } });
  if (!batch) notFound();
  return <BatchEditor batchId={batch.id} batch={{
    id: batch.id,
    name: batch.name,
    slug: batch.slug,
    status: batch.status,
    updatedAt: batch.updatedAt.toISOString(),
    organizationId: batch.organizationId,
  }} />;
}
