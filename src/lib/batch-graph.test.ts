import assert from "node:assert/strict";
import test from "node:test";
import { autoLayout, canConnect, createNode, insertNodeOnBatchEdge, makeBatchEdge, reconnectBatchEdge, serializeGraph, validateGraph, validateGraphDiagnostics, type BatchEdge, type BatchNode } from "@/lib/batch-graph";
import { apiObjectSchema, batchVersionCreateSchema } from "@/lib/schemas/api";

function node(toolId: string, index: number): BatchNode {
  const result = createNode(toolId, { x: index * 240, y: 100 });
  assert.ok(result, `tool ${toolId} should exist`);
  return result;
}

test("accepts compatible PDF connections and rejects incompatible types", () => {
  const input = node("input.pdf", 0);
  const rotate = node("pdf.rotate", 1);
  const detect = node("pdf.detect-page-size", 2);
  const connection = { source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" };
  assert.equal(canConnect(connection, [input, rotate], []), true);
  assert.equal(canConnect({ ...connection, target: detect.id, targetHandle: "pdf" }, [input, detect], []), true);
  const jsonOutput = { source: detect.id, target: rotate.id, sourceHandle: "pages", targetHandle: "pdf" };
  assert.equal(canConnect(jsonOutput, [detect, rotate], []), false);
});

test("rejects duplicate single-value input links and graph cycles", () => {
  const first = node("input.pdf", 0);
  const second = node("input.pdf", 1);
  const output = node("output.pdf", 2);
  const edge: BatchEdge = { id: "edge-1", source: first.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" };
  assert.equal(canConnect({ source: second.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }, [first, second, output], [edge]), false);

  const a = node("flow.merge", 3);
  const b = node("flow.merge", 4);
  const forward: BatchEdge = { id: "edge-2", source: a.id, target: b.id, sourceHandle: "value", targetHandle: "values" };
  assert.equal(canConnect({ source: b.id, target: a.id, sourceHandle: "value", targetHandle: "values" }, [a, b], [forward]), false);
});

test("validates mandatory nodes and required inputs", () => {
  const input = node("input.pdf", 0);
  const rotate = node("pdf.rotate", 1);
  const output = node("output.pdf", 2);
  const issues = validateGraph([input, rotate, output], []);
  assert.ok(issues.some((issue) => issue.includes("collega l'ingresso")));
  assert.equal(issues.some((issue) => issue.includes("degrees")), false, "degrees uses the registry default");
});

test("reports validation diagnostics with stable node and edge references", () => {
  const input = node("input.pdf", 0), rotate = node("pdf.rotate", 1), output = node("output.pdf", 2);
  const missingInput = validateGraphDiagnostics([input, rotate, output], []);
  assert.ok(missingInput.some((item) => item.nodeId === rotate.id && item.code === "MISSING_INPUT"));
  const badEdge: BatchEdge = { id: "bad-port-edge", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pages" };
  const diagnostics = validateGraphDiagnostics([input, rotate, output], [badEdge]);
  assert.ok(diagnostics.some((item) => item.edgeId === badEdge.id && item.code === "INVALID_EDGE"));
  assert.ok(diagnostics.some((item) => item.nodeId === rotate.id && item.code === "MISSING_INPUT"));
});

test("validates IF branch handles and routes all declared control edges", () => {
  const input = node("input.pdf", 0), condition = node("logic.if", 1), output = node("output.pdf", 2);
  condition.data.parameters = { leftType: "number", rightType: "number", left: 1, right: 1, operator: "eq", caseSensitive: false, nullBehavior: "equalOnly" };
  const edges: BatchEdge[] = [
    { id: "pdf", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "true", source: condition.id, target: output.id, sourceHandle: "true", targetHandle: "run", data: { kind: "control" } },
    { id: "false", source: condition.id, target: output.id, sourceHandle: "false", targetHandle: "run", data: { kind: "control" } },
  ];
  assert.deepEqual(validateGraphDiagnostics([input, condition, output], edges), []);
});

test("accepts pdf.output as the managed artifact sink and requires its document connection", () => {
  const input = node("input.pdf", 0);
  const output = node("pdf.output", 1);
  assert.ok(validateGraph([input, output], []).some((issue) => issue.includes('collega l\'ingresso "document"')));
  const edge = makeBatchEdge({ source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "document" }, [input, output]);
  assert.ok(edge);
  assert.deepEqual(validateGraph([input, output], [edge]), []);
});

test("accepts a complete PDF graph and validates API JSON Schemas", () => {
  const input = node("input.pdf", 0);
  const rotate = node("pdf.rotate", 1);
  const output = node("output.pdf", 2);
  rotate.data.parameters.degrees = 90;
  const edges: BatchEdge[] = [
    { id: "in", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "out", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  assert.deepEqual(validateGraph([input, rotate, output], edges), []);
  assert.equal(apiObjectSchema.safeParse({ type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false }).success, true);
  assert.equal(apiObjectSchema.safeParse({ type: "object", properties: {}, required: ["missing"], additionalProperties: false }).success, false);
  assert.equal(batchVersionCreateSchema.safeParse({ graph: serializeGraph([input, rotate, output], edges), inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, toolManifest: [] }).success, true);
  const withVariables = serializeGraph([input, rotate, output], edges, undefined, [{ name: "suffix", type: "string", defaultValue: "archivio" }, { name: "copies", type: "number", defaultValue: 2 }]);
  assert.equal(batchVersionCreateSchema.safeParse({ graph: withVariables, inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, toolManifest: [] }).success, true);
  assert.equal(batchVersionCreateSchema.safeParse({ graph: { ...withVariables, variables: [...(withVariables.variables ?? []), { name: "suffix", type: "boolean", defaultValue: true }] }, inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, toolManifest: [] }).success, false);
});

test("serializes a graph and restores its node and edge data", () => {
  const input = node("input.pdf", 0);
  const output = node("output.pdf", 1);
  const edge: BatchEdge = { id: "persisted-edge", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf", type: "smoothstep" };
  const serialized = serializeGraph([input, output], [edge]);
  const restored = JSON.parse(JSON.stringify(serialized)) as { nodes: BatchNode[]; edges: BatchEdge[] };
  assert.deepEqual(restored.nodes.map((item) => item.data.toolId), ["input.pdf", "output.pdf"]);
  assert.equal(restored.edges[0].targetHandle, "pdf");
  assert.equal(canConnect({ source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }, restored.nodes, []), true);
});

test("serializes the viewport and auto-layout places dependencies in successive columns", () => {
  const input = node("input.pdf", 0);
  const rotate = node("pdf.rotate", 1);
  const output = node("output.pdf", 2);
  const edges: BatchEdge[] = [
    { id: "in", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "out", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  const serialized = serializeGraph([input, rotate, output], edges, { x: -32, y: 16, zoom: 0.8 });
  assert.deepEqual(serialized.viewport, { x: -32, y: 16, zoom: 0.8 });
  const layout = autoLayout([output, rotate, input], edges);
  const position = new Map(layout.map((item) => [item.id, item.position]));
  assert.ok(position.get(input.id)!.x < position.get(rotate.id)!.x);
  assert.ok(position.get(rotate.id)!.x < position.get(output.id)!.x);
});

test("separates control and data edges and supports true/false control routing", () => {
  const input = node("input.pdf", 0);
  const condition = node("flow.condition", 1);
  const rotate = node("pdf.rotate", 2);
  const invalidControlData = { source: condition.id, target: rotate.id, sourceHandle: "true", targetHandle: "pdf" };
  const validControl = { source: condition.id, target: rotate.id, sourceHandle: "true", targetHandle: "run" };
  const validData = { source: condition.id, target: rotate.id, sourceHandle: "value", targetHandle: "pdf" };
  assert.equal(canConnect(invalidControlData, [input, condition, rotate], []), false);
  assert.equal(canConnect(validControl, [input, condition, rotate], []), true);
  assert.equal(canConnect(validData, [input, condition, rotate], []), true);
  const controlEdge = makeBatchEdge(validControl, [input, condition, rotate]);
  assert.equal(controlEdge?.data?.kind, "control");
  assert.equal(controlEdge?.data?.label, "true");
  assert.equal(canConnect(validControl, [input, condition, rotate], controlEdge ? [controlEdge] : []), false);
});

test("reconnect rejects incompatible endpoints and node insertion replaces a compatible edge", () => {
  const input = node("input.pdf", 0);
  const rotate = node("pdf.rotate", 1);
  const output = node("output.pdf", 2);
  const existing = makeBatchEdge({ source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }, [input, output]);
  assert.ok(existing);
  assert.equal(reconnectBatchEdge(existing, { source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pages" }, [input, rotate, output], [existing]), null);
  const inserted = insertNodeOnBatchEdge(existing, "pdf.rotate", { x: 100, y: 100 }, [input, output], [existing]);
  assert.ok(inserted);
  assert.equal(inserted.edges.length, 2);
  assert.ok(inserted.edges.every((edge) => edge.data?.kind === "data"));
  assert.equal(insertNodeOnBatchEdge(existing, "pdf.detect-page-size", { x: 100, y: 100 }, [input, output], [existing]), null);
});
