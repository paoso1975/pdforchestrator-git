import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpression, resolveParameterBindings } from "@/lib/blocks/bindings";

const context = { api: { count: 4, token: "x" }, nodes: { n1: { pages: 4 } }, variables: { threshold: 3 }, loop: { item: 9 } };

test("resolves declared binding sources and legacy API binding", () => {
  assert.deepEqual(resolveParameterBindings({ a: { source: "api", name: "count" }, b: { source: "node", nodeId: "n1", port: "pages" }, c: { $param: "token" } }, context), { a: 4, b: 4, c: "x" });
  assert.equal(resolveParameterBindings({ source: "constant", value: "safe" }, context), "safe");
  assert.equal(resolveParameterBindings({ source: "variable", name: "threshold" }, context), 3);
  assert.equal(resolveParameterBindings({ source: "loop", name: "item" }, context), 9);
});

test("resolves safe API and node paths into QR, OCR and metadata values", () => {
  const nested = { ...context, api: { ...context.api, document: { metadata: { title: "Invoice" } } }, nodes: { ...context.nodes, qr: { codes: [{ text: "QR-42" }] }, ocr: { text: "Invoice 42" } } };
  assert.equal(resolveParameterBindings({ source: "api", name: "document", path: ["metadata", "title"] }, nested), "Invoice");
  assert.equal(resolveParameterBindings({ source: "node", nodeId: "qr", port: "codes", path: ["0", "text"] }, nested), "QR-42");
  assert.equal(resolveParameterBindings({ source: "node", nodeId: "ocr", port: "text" }, nested), "Invoice 42");
  assert.throws(() => resolveParameterBindings({ source: "node", nodeId: "qr", port: "codes", path: ["__proto__"] }, nested), /Percorso/);
});

test("evaluates bounded declarative expressions without dynamic code", () => {
  assert.equal(evaluateExpression({ op: "gt", left: { op: "path", root: "api", path: ["count"] }, right: { op: "literal", value: 2 } }, context), true);
  assert.equal(evaluateExpression({ op: "concat", args: [{ op: "literal", value: "pages=" }, { op: "path", root: "nodes", path: ["n1", "pages"] }] }, context), "pages=4");
  assert.throws(() => evaluateExpression({ op: "path", root: "api", path: ["__proto__", "polluted"] }, context), /non valida/);
  assert.throws(() => resolveParameterBindings({ source: "api", name: "missing" }, context), /non risolve/);
});
