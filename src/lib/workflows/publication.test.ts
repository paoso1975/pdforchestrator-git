import assert from "node:assert/strict";
import test from "node:test";
import { createNode, type BatchEdge } from "@/lib/batch-graph";
import { compileWorkflowDraft } from "@/lib/workflows/publication";

function node(type: string, x: number) { const value = createNode(type, { x, y: 0 }); assert.ok(value); return value; }
function draft(nodes: ReturnType<typeof node>[], edges: BatchEdge[]) {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: {} } };
}

test("workflow compilation checks handlers and returns a stable immutable snapshot hash", () => {
  const input = node("input.pdf", 0), rotate = node("pdf.rotate", 1), output = node("output.pdf", 2);
  const edges: BatchEdge[] = [
    { id: "a", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "b", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  const first = compileWorkflowDraft(draft([input, rotate, output], edges));
  const second = compileWorkflowDraft(draft([output, rotate, input], [...edges].reverse()));
  assert.deepEqual(first.diagnostics, []);
  assert.ok(first.plan);
  assert.ok(second.plan);
  assert.equal(first.plan.formatVersion, 2);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.handlerDependencies.map(({ type }) => type), ["input.pdf", "output.pdf", "pdf.rotate"]);
  assert.equal(second.hash, first.hash);
});

test("workflow compilation reports unresolved block handlers with node diagnostics", () => {
  const input = node("input.pdf", 0);
  input.data.toolId = "pdf.missing";
  const result = compileWorkflowDraft(draft([input], []));
  assert.equal(result.plan, null);
  assert.ok(result.diagnostics.some((item) => item.code === "HANDLER_UNAVAILABLE" && item.nodeId === input.id));
});

test("workflow snapshot hash includes schemas and viewport data", () => {
  const input = node("input.pdf", 0), output = node("output.pdf", 1);
  const edges: BatchEdge[] = [{ id: "e", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }];
  const initial = draft([input, output], edges);
  const baseline = compileWorkflowDraft(initial);
  const withChangedSchema = compileWorkflowDraft({ ...initial, inputSchema: { type: "object", properties: { pages: { type: "integer" } } } });
  const withChangedViewport = compileWorkflowDraft({ ...initial, viewport: { x: 20, y: 10, zoom: 1 } });
  assert.notEqual(withChangedSchema.hash, baseline.hash);
  assert.notEqual(withChangedViewport.hash, baseline.hash);
});
