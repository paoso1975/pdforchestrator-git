import assert from "node:assert/strict";
import test from "node:test";
import { workflowDraftPayloadSchema, workflowPublicationPayloadSchema } from "@/lib/workflows/schemas";

test("workflow draft accepts typed nodes, edges, viewport and revision", () => {
  const result = workflowDraftPayloadSchema.safeParse({
    expectedRevision: 4,
    nodes: [{ id: "input", type: "tool", position: { x: 0, y: 1 }, data: { toolId: "input.pdf", parameters: {} } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, inputSchema: {}, outputSchema: {},
  });
  assert.equal(result.success, true);
});

test("workflow draft rejects dangling edges and non-positive zoom", () => {
  const result = workflowDraftPayloadSchema.safeParse({
    expectedRevision: 1, nodes: [], edges: [{ source: "missing", target: "also-missing" }],
    viewport: { x: 0, y: 0, zoom: 0 }, inputSchema: {}, outputSchema: {},
  });
  assert.equal(result.success, false);
});

test("workflow validation and publication accept only the expected draft revision", () => {
  assert.equal(workflowPublicationPayloadSchema.safeParse({ expectedRevision: 1 }).success, true);
  assert.equal(workflowPublicationPayloadSchema.safeParse({ expectedRevision: 0 }).success, false);
  assert.equal(workflowPublicationPayloadSchema.safeParse({ expectedRevision: 1, compiledPlan: {}, hash: "a".repeat(64) }).success, false);
});
