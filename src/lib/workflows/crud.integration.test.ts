import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL;
const isDedicatedTestDatabase = (() => {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return /test/i.test(url.pathname) || /test/i.test(url.hostname);
  } catch {
    return false;
  }
})();

test("workflow models support tenant-scoped CRUD and revision concurrency", { skip: !isDedicatedTestDatabase }, async () => {
  const adapter = new PrismaPg({ connectionString: databaseUrl!, max: 1 });
  const prisma = new PrismaClient({ adapter });
  const rollback = new Error("rollback workflow CRUD fixture");

  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: "Workflow CRUD Test", slug: `workflow-test-${crypto.randomUUID()}` },
      });
      const workflow = await tx.workflow.create({ data: {
        organizationId: organization.id,
        name: "Example workflow",
        slug: "example-workflow",
      } });
      const nodes = [{ id: "input", type: "tool", position: { x: 0, y: 0 }, data: { toolId: "input.pdf" } }];
      const draft = await tx.workflowDraft.create({ data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        revision: 1,
        nodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
      } });
      assert.equal(draft.revision, 1);
      const write = await tx.workflow.updateMany({ where: { id: workflow.id, organizationId: organization.id, revision: 1 }, data: { revision: 2 } });
      const staleWrite = await tx.workflow.updateMany({ where: { id: workflow.id, organizationId: organization.id, revision: 1 }, data: { revision: 3 } });
      assert.equal(write.count, 1);
      assert.equal(staleWrite.count, 0);
      await tx.workflowDraft.update({ where: { workflowId: workflow.id }, data: { revision: 2, viewport: { x: 10, y: 20, zoom: 1.2 } } });

      const version = await tx.workflowVersion.create({ data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        version: 1,
        revision: 2,
        nodes,
        edges: [],
        viewport: { x: 10, y: 20, zoom: 1.2 },
        compiledPlan: { nodeOrder: ["input"] },
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        hash: "a".repeat(64),
      } });
      await tx.workflow.update({ where: { id: workflow.id }, data: { status: "PUBLISHED", activeVersionId: version.id } });
      await tx.workflowPublication.create({ data: { organizationId: organization.id, workflowId: workflow.id, workflowVersionId: version.id } });
      await tx.workflowPublication.create({ data: { organizationId: organization.id, workflowId: workflow.id, workflowVersionId: version.id } });

      const credential = await tx.apiCredential.create({ data: {
        organizationId: organization.id,
        name: "CRUD integration credential",
        tokenHash: crypto.randomUUID(),
        tokenPrefix: "test",
      } });
      await tx.workflowCredentialGrant.create({ data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        credentialId: credential.id,
      } });
      const run = await tx.workflowRun.create({ data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        credentialId: credential.id,
        input: { document: "fixture.pdf" },
      } });
      const nodeRun = await tx.workflowNodeRun.create({ data: {
        organizationId: organization.id,
        workflowRunId: run.id,
        nodeId: "input",
        toolId: "input.pdf",
        toolVersion: "1.0.0",
      } });
      await tx.workflowArtifact.create({ data: {
        organizationId: organization.id,
        workflowRunId: run.id,
        nodeRunId: nodeRun.id,
        bucket: "test-bucket",
        objectKey: `workflow-test/${run.id}/out.pdf`,
        filename: "out.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(20),
        sha256: "b".repeat(64),
      } });
      await tx.auditEvent.create({ data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        action: "workflow.published",
        resourceType: "Workflow",
        resourceId: workflow.id,
        metadata: { version: 1 },
      } });

      const loaded = await tx.workflow.findFirst({
        where: { id: workflow.id, organizationId: organization.id },
        include: { activeVersion: true, drafts: true, runs: { include: { nodeRuns: true, artifacts: true } }, publications: true, credentialGrants: true, auditEvents: true },
      });
      assert.equal(loaded?.revision, 2);
      assert.equal(loaded?.activeVersion?.hash, "a".repeat(64));
      assert.equal(loaded?.drafts[0]?.revision, 2);
      assert.equal(loaded?.runs[0]?.nodeRuns.length, 1);
      assert.equal(loaded?.runs[0]?.artifacts.length, 1);
      assert.equal(loaded?.publications.length, 2);
      assert.equal(loaded?.credentialGrants.length, 1);
      assert.equal(loaded?.auditEvents.length, 1);

      await tx.workflowRun.update({ where: { id: run.id }, data: { status: "RUNNING", progress: 25 } });
      assert.equal((await tx.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).progress, 25);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});
