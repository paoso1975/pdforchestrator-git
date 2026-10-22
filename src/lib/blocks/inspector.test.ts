import assert from "node:assert/strict";
import test from "node:test";
import { createNode } from "@/lib/batch-graph";
import { getParameterIssues, getPreviousNodes, isApiParameterCompatible, isCompatibleParameterType } from "@/lib/blocks/inspector";
import { getBlockDefinition } from "@/lib/blocks/registry";

function node(type: string, x: number) { const result = createNode(type, { x, y: 0 }); assert.ok(result); return result; }

test("variable picker scope contains only upstream nodes", () => {
  const input = node("input.pdf", 0), rotate = node("pdf.rotate", 1), unrelated = node("pdf.detect-qr", 2), output = node("output.pdf", 3);
  const previous = getPreviousNodes(output.id, [input, rotate, unrelated, output], [
    { id: "a", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "b", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ]);
  assert.deepEqual(previous.map((item) => item.id), [input.id, rotate.id]);
});

test("picker filters bindings by parameter type and validates required values inline", () => {
  assert.equal(isCompatibleParameterType("array", "pdf-list"), true);
  assert.equal(isCompatibleParameterType("number", "string"), false);
  const merge = getBlockDefinition("pdf.merge", "1.1.0"); assert.ok(merge);
  assert.match(getParameterIssues(merge, {}).mergePlan, /obbligatorio|Invalid input/i);
  assert.deepEqual(getParameterIssues(merge, { mergePlan: { files: [{ filename: "a.pdf", position: 1 }] } }), {});
});

test("TIFF dpi picker accepts numeric API parameters only for the dpi field", () => {
  assert.equal(isApiParameterCompatible("pdf.convert.tiff", "dpi", "integer", "number"), true);
  assert.equal(isApiParameterCompatible("pdf.convert.tiff", "dpi", "integer", "string"), false);
  assert.equal(isApiParameterCompatible("pdf.rotate", "degrees", "number", "number"), true);
  assert.equal(isApiParameterCompatible("pdf.rotate", "degrees", "number", "string"), false);
});

test("condition group inspector reports an unset or over-complex AST inline", () => {
  const group = getBlockDefinition("logic.conditionGroup"); assert.ok(group);
  assert.match(getParameterIssues(group, {}).condition, /condition|input/i);
  const condition = { kind: "group", operator: "OR", conditions: Array.from({ length: 3 }, () => ({ kind: "group", operator: "AND", conditions: Array.from({ length: 11 }, () => ({ kind: "comparison", leftType: "number", rightType: "number", left: 1, right: 2, operator: "lt" })) })) };
  assert.match(getParameterIssues(group, { condition }).condition, /limite di 32 confronti/);
});

test("conditional loop inspector requires a valid condition AST and maxIterations", () => {
  const loop = getBlockDefinition("loop.while"); assert.ok(loop);
  assert.ok(getParameterIssues(loop, {}).condition);
  assert.ok(getParameterIssues(loop, { condition: { kind: "comparison", leftType: "number", rightType: "number", left: 0, right: 1, operator: "lt" } }).maxIterations);
  assert.deepEqual(getParameterIssues(loop, { condition: { kind: "comparison", leftType: "number", rightType: "number", left: 0, right: 1, operator: "lt" }, maxIterations: 5 }), {});
});
