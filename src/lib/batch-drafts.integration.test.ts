import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";

const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
const dedicatedTestDatabase = (() => {
  if (!databaseUrl) return false;
  try { const parsed = new URL(databaseUrl); return /test/i.test(parsed.pathname) || /test/i.test(parsed.hostname); } catch { return false; }
})();

test("batch drafts persist snapshots and reject stale revision writes", { skip: !dedicatedTestDatabase }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 1 }) });
  const rollback = new Error("rollback batch draft integration fixture");
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: "Draft Test", slug: `draft-test-${crypto.randomUUID()}` } });
      const batch = await tx.batch.create({ data: { organizationId: organization.id, name: "Canvas", slug: "canvas" } });
      const graph = { nodes: [{ id: "n1", type: "tool", position: { x: 31, y: 77 }, data: { toolId: "input.pdf", toolVersion: "1.0.0", parameters: {} } }], edges: [], viewport: { x: -20, y: 30, zoom: 0.8 } };
      const inputSchema = { type: "object", properties: {}, required: [], additionalProperties: false } as Prisma.InputJsonValue;
      const outputSchema = { type: "object", properties: {}, required: [], additionalProperties: false } as Prisma.InputJsonValue;
      const version = await tx.batchVersion.create({ data: { batchId: batch.id, version: 1, revision: 1, graph: graph as Prisma.InputJsonValue, inputSchema, outputSchema, toolManifest: { draft: true }, configHash: "a".repeat(64) } });
      await tx.batchDraftRevision.create({ data: { organizationId: organization.id, batchId: batch.id, revision: 1, batchName: "Canvas", graph: graph as Prisma.InputJsonValue, inputSchema, outputSchema } });
      const write = await tx.batchVersion.updateMany({ where: { id: version.id, revision: 1, publishedAt: null }, data: { revision: 2, graph: { ...graph, viewport: { x: 100, y: 200, zoom: 1.2 } } } });
      const staleWrite = await tx.batchVersion.updateMany({ where: { id: version.id, revision: 1, publishedAt: null }, data: { revision: 3 } });
      assert.equal(write.count, 1); assert.equal(staleWrite.count, 0);
      const snapshot = await tx.batchDraftRevision.findFirstOrThrow({ where: { batchId: batch.id, revision: 1 } });
      assert.deepEqual(snapshot.graph, graph);
      await tx.auditEvent.create({ data: { organizationId: organization.id, action: "batch.draft.saved", resourceType: "BatchDraft", resourceId: batch.id, metadata: { revision: 1 } } });
      assert.equal(await tx.auditEvent.count({ where: { organizationId: organization.id, resourceId: batch.id, action: "batch.draft.saved" } }), 1);
      const current = await tx.batchVersion.findUniqueOrThrow({ where: { id: version.id } });
      assert.equal(current.revision, 2);
      assert.deepEqual((current.graph as typeof graph).viewport, { x: 100, y: 200, zoom: 1.2 });
      throw rollback;
    }), (error) => error === rollback);
  } finally { await prisma.$disconnect(); }
});
