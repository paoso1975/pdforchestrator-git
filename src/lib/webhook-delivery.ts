import "server-only";
import type { Prisma } from "@/generated/prisma/client";

const eventMap = { COMPLETED: "execution.completed", FAILED: "execution.failed", CANCELLED: "execution.cancelled" } as const;
export async function enqueueWebhookDeliveries(tx: Prisma.TransactionClient, organizationId: string, executionId: string, eventId: string, status: keyof typeof eventMap, payload: Record<string, unknown>) {
  const eventType = eventMap[status];
  const endpoints = await tx.webhookEndpoint.findMany({ where: { organizationId, enabled: true, eventTypes: { has: eventType } }, select: { id: true } });
  if (!endpoints.length) return;
  await tx.webhookDelivery.createMany({ data: endpoints.map((endpoint) => ({ endpointId: endpoint.id, eventId, payload: { id: eventId, type: eventType, createdAt: new Date().toISOString(), data: { executionId, ...payload } }, status: "PENDING", nextAttemptAt: new Date() })), skipDuplicates: true });
}
