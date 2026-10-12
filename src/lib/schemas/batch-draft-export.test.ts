import assert from "node:assert/strict";
import test from "node:test";
import { createNode, serializeGraph, type BatchEdge, type BatchNode } from "@/lib/batch-graph";
import { batchDraftExportSchema, isWithinBatchDraftLimit, MAX_BATCH_DRAFT_BYTES } from "@/lib/schemas/batch-draft-export";
import { batchDraftWriteSchema } from "@/lib/schemas/api";
import { PayloadTooLargeError, readBoundedRequestBody } from "@/lib/http-body";

function node(type: string, x: number): BatchNode { const item = createNode(type, { x, y: x + 3 }); assert.ok(item); return item; }

test("draft export schema round-trips canvas positions, edges, viewport and variables", () => {
  const input = node("input.pdf-list", 35), merge = node("pdf.merge", 280), output = node("output.pdf", 520);
  const edges: BatchEdge[] = [
    { id: "e1", source: input.id, target: merge.id, sourceHandle: "pdfs", targetHandle: "pdfs" },
    { id: "e2", source: merge.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  const exported = batchDraftExportSchema.parse({ formatVersion: 1, batchName: "Test", graph: serializeGraph([input, merge, output], edges, { x: -140, y: 90, zoom: 0.72 }, [{ name: "suffix", type: "string", defaultValue: "final" }]), inputSchema: { type: "object", properties: { documents: { type: "array", items: { type: "string" } } }, required: ["documents"], additionalProperties: false }, outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } });
  const reopened = batchDraftExportSchema.parse(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(reopened.graph.nodes.map((item) => item.position), [{ x: 35, y: 38 }, { x: 280, y: 283 }, { x: 520, y: 523 }]);
  assert.deepEqual(reopened.graph.edges.map((edge) => [edge.source, edge.target, edge.sourceHandle, edge.targetHandle]), edges.map((edge) => [edge.source, edge.target, edge.sourceHandle, edge.targetHandle]));
  assert.deepEqual(reopened.graph.viewport, { x: -140, y: 90, zoom: 0.72 });
  assert.equal(reopened.graph.variables?.[0].name, "suffix");
  assert.equal(batchDraftWriteSchema.safeParse({ expectedRevision: null, graph: reopened.graph, inputSchema: reopened.inputSchema, outputSchema: reopened.outputSchema, batchName: reopened.batchName }).success, true);
  assert.equal(batchDraftExportSchema.safeParse({ ...exported, graph: { ...exported.graph, edges: [{ id: "bad", source: "gone", target: "node" }] } }).success, false);
});

test("draft JSON size guard counts UTF-8 bytes", () => {
  assert.equal(isWithinBatchDraftLimit("a".repeat(MAX_BATCH_DRAFT_BYTES)), true);
  assert.equal(isWithinBatchDraftLimit("a".repeat(MAX_BATCH_DRAFT_BYTES + 1)), false);
  assert.equal(isWithinBatchDraftLimit("è".repeat(MAX_BATCH_DRAFT_BYTES / 2 + 1)), false);
});

test("bounded request reader rejects oversized bodies while streaming", async () => {
  const body = new Request("https://local.test", { method: "PUT", body: "0123456789" });
  assert.equal(await readBoundedRequestBody(body, 10), "0123456789");
  const tooLarge = new Request("https://local.test", { method: "PUT", body: "01234567890" });
  await assert.rejects(readBoundedRequestBody(tooLarge, 10), PayloadTooLargeError);
});
