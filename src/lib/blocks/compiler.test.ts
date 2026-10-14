import assert from "node:assert/strict";
import test from "node:test";
import { createNode, type BatchEdge } from "@/lib/batch-graph";
import { compileGraph } from "@/lib/blocks/compiler";
import { generateApiDefinition } from "@/lib/api-schema";

function node(type: string, x: number) { const item = createNode(type, { x, y: 0 }); assert.ok(item); return item; }

test("compiles a validated graph in dependency order with exact handlers", () => {
  const input = node("input.pdf", 0), rotate = node("pdf.rotate", 1), output = node("output.pdf", 2);
  const edges: BatchEdge[] = [
    { id: "a", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "b", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  const plan = compileGraph([output, rotate, input], edges);
  assert.deepEqual(plan.order, [input.id, rotate.id, output.id]);
  assert.equal(plan.blocks[1].handlerId, "pdf.rotate");
  assert.equal(plan.blocks[1].parameters.degrees, 90);
  assert.equal(plan.formatVersion, 2);
  assert.match(plan.graphHash, /^[a-f0-9]{64}$/);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(compileGraph([input, rotate, output], edges).planHash, plan.planHash);
  assert.deepEqual(compileGraph([output, rotate, input], [...edges].reverse()), plan);
});

test("compiles QR record matching with required API list and API supplied PDF filename", () => {
  const input = node("input.pdf", 0), matcher = node("pdf.qr.removeMatchedPages", 1), output = node("pdf.output.apiName", 2);
  matcher.data.parameters.records = { source: "api", name: "elencoQR" };
  output.data.parameters.filename = { source: "api", name: "FileFinale" };
  const edges: BatchEdge[] = [
    { id: "input-matcher", source: input.id, target: matcher.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "matcher-output", source: matcher.id, target: output.id, sourceHandle: "pdf", targetHandle: "document" },
  ];
  const api = generateApiDefinition([input, matcher, output]);
  assert.deepEqual(api.issues, []);
  assert.deepEqual(api.parameters.map(({ name, type, required }) => ({ name, type, required })), [
    { name: "documento", type: "pdf", required: true },
    { name: "elencoQR", type: "array", required: true },
    { name: "FileFinale", type: "string", required: true },
  ]);
  const recordsSchema = api.inputSchema.properties.elencoQR as { items?: { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }; minItems?: number; maxItems?: number };
  assert.deepEqual(Object.keys(recordsSchema.items?.properties ?? {}).sort(), ["nomeQR", "testoQR"]);
  assert.deepEqual(recordsSchema.items?.required, ["testoQR", "nomeQR"]);
  assert.equal(recordsSchema.minItems, 1);
  assert.equal(recordsSchema.maxItems, 10000);
  assert.match(String((api.inputSchema.properties.FileFinale as { pattern?: string }).pattern), /\\.pdf/);
  const plan = compileGraph([input, matcher, output], edges, {
    apiParameters: api.parameters.map((item) => item.name),
    apiParameterTypes: Object.fromEntries(api.parameters.map((item) => [item.name, item.type === "pdf" ? "string" : item.type])),
  });
  assert.deepEqual(plan.blocks.map((block) => block.handlerId), ["input.pdf", "pdf.qr.removeMatchedPages", "pdf.output"]);
});

test("compiled plan order, edge list and hashes are stable for independent nodes", () => {
  const input = node("input.pdf", 0), condition = node("logic.if", 1), output = node("output.pdf", 2);
  condition.data.parameters = { leftType: "number", rightType: "number", left: 1, right: 2, operator: "lt", caseSensitive: false, nullBehavior: "equalOnly" };
  const edges: BatchEdge[] = [
    { id: "output-pdf", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "condition-true", source: condition.id, target: output.id, sourceHandle: "true", targetHandle: "run", data: { kind: "control" } },
  ];
  const first = compileGraph([input, condition, output], edges);
  const reordered = compileGraph([output, condition, input], [...edges].reverse());
  assert.deepEqual(reordered, first);
});

test("compiles stable page deletion inside eachPage and rejects ambiguous selectors", () => {
  const input = node("input.pdf", 0), loop = node("loop.eachPage", 1), remove = node("pdf.page.delete", 2), output = node("output.pdf", 3);
  loop.data.parameters = { start: 1, step: 1, maxIterations: 10 };
  remove.data.parameters = { pageId: { source: "loop", name: "pageId" } };
  const edges: BatchEdge[] = [
    { id: "input-loop", source: input.id, target: loop.id, sourceHandle: "pdf", targetHandle: "document" },
    { id: "body-remove", source: loop.id, target: remove.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "document-remove", source: loop.id, target: remove.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "document-output", source: loop.id, target: output.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "after-output", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  assert.equal(compileGraph([input, loop, remove, output], edges).blocks.find((block) => block.nodeId === remove.id)?.handlerId, "pdf.page.delete");
  remove.data.parameters = { page: 1, pages: [2] };
  assert.throws(() => compileGraph([input, loop, remove, output], edges), /esattamente uno tra page, pages e pageId/);
});

test("refuses to compile invalid parameter values", () => {
  const input = node("input.pdf", 0), output = node("output.pdf", 1);
  output.data.parameters.filename = "";
  assert.throws(() => compileGraph([input, output], [{ id: "e", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }]), /filename/);
});

test("compiles scoped API and node bindings while rejecting unavailable sources", () => {
  const input = node("input.pdf", 0), rotate = node("pdf.rotate", 1), output = node("output.pdf", 2);
  rotate.data.parameters.degrees = { source: "api", name: "angle" };
  output.data.parameters.filename = { source: "node", nodeId: rotate.id, port: "pdf" };
  const edges: BatchEdge[] = [
    { id: "a", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "b", source: rotate.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ];
  const plan = compileGraph([input, rotate, output], edges, {
    apiParameters: ["angle"], variables: ["copies"], apiParameterTypes: { angle: "number" }, variableTypes: { copies: "number" },
    apiParameterManifest: [{ name: "angle", type: "number", required: true }],
    variableManifest: [{ name: "copies", type: "number", required: false, defaultValue: 2 }],
  });
  assert.deepEqual(plan.blocks[1].parameters.degrees, { source: "api", name: "angle" });
  assert.deepEqual(plan.manifest.apiParameters, [{ name: "angle", type: "number", required: true }]);
  assert.deepEqual(plan.manifest.variables, [{ name: "copies", type: "number", required: false, defaultValue: 2 }]);
  assert.throws(() => compileGraph([input, rotate, output], edges, { apiParameters: [], variables: [] }), /parametro API/);

  const unrelated = node("input.pdf", 3);
  output.data.parameters.filename = { source: "node", nodeId: unrelated.id, port: "pdf" };
  assert.throws(() => compileGraph([input, rotate, output, unrelated], edges, { apiParameters: ["angle"], variables: [] }), /scope del nodo/);
});

test("compiles logic.if bindings with declared source types and rejects mismatches", () => {
  const input = node("input.pdf", 0), condition = node("logic.if", 1), output = node("output.pdf", 2);
  condition.data.parameters = {
    leftType: "number", rightType: "number", left: { source: "api", name: "pageCount" }, right: 10,
    operator: "gte", caseSensitive: false, nullBehavior: "equalOnly",
  };
  const edges: BatchEdge[] = [
    { id: "pdf", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "branch", source: condition.id, target: output.id, sourceHandle: "true", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, condition, output], edges, { apiParameters: ["pageCount"], apiParameterTypes: { pageCount: "number" } });
  assert.equal(plan.blocks.find((item) => item.nodeId === condition.id)?.handlerId, "logic.if");
  assert.throws(() => compileGraph([input, condition, output], edges, { apiParameters: ["pageCount"], apiParameterTypes: { pageCount: "string" } }), /binding fornisce string/);
  condition.data.parameters.left = { source: "node", nodeId: input.id, port: "pdf" };
  condition.data.parameters.leftType = "number";
  assert.throws(() => compileGraph([input, condition, output], edges, { apiParameters: ["pageCount"] }), /binding fornisce string/);
  condition.data.parameters.leftType = "string";
  condition.data.parameters.rightType = "number";
  condition.data.parameters.left = "abc";
  assert.throws(() => compileGraph([input, condition, output], edges, { apiParameters: ["pageCount"] }), /entrambi gli operandi devono essere number/);
});

test("compiles nested condition groups with typed API bindings and rejects mismatches", () => {
  const input = node("input.pdf", 0), group = node("logic.conditionGroup", 1), output = node("output.pdf", 2);
  group.data.parameters.condition = {
    kind: "group", operator: "AND", conditions: [
      { kind: "comparison", leftType: "number", rightType: "number", left: { source: "api", name: "pageCount" }, right: 2, operator: "gte" },
      { kind: "not", condition: { kind: "comparison", leftType: "string", rightType: "string", left: { source: "api", name: "documentState", path: ["status"] }, right: "blocked", operator: "eq" } },
    ],
  };
  const edges: BatchEdge[] = [
    { id: "pdf", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "branch", source: group.id, target: output.id, sourceHandle: "true", targetHandle: "run", data: { kind: "control" } },
  ];
  const options = { apiParameters: ["pageCount", "documentState"], apiParameterTypes: { pageCount: "number", documentState: "object" } };
  const plan = compileGraph([input, group, output], edges, options);
  assert.equal(plan.blocks.find((item) => item.nodeId === group.id)?.handlerId, "logic.conditionGroup");
  assert.throws(() => compileGraph([input, group, output], edges, { ...options, apiParameterTypes: { pageCount: "string", documentState: "string" } }), /binding fornisce string/);
  group.data.parameters.condition = { kind: "group", operator: "AND", conditions: Array.from({ length: 3 }, () => ({ kind: "group", operator: "OR", conditions: Array.from({ length: 11 }, () => ({ kind: "comparison", leftType: "number", rightType: "number", left: 1, right: 0, operator: "gt" })) })) };
  assert.throws(() => compileGraph([input, group, output], edges, options), /limite di 32 confronti/);
});

test("compiles loop variable bindings only inside the body scope", () => {
  const input = node("input.pdf", 0), loop = node("loop.eachPage", 1), rotate = node("pdf.rotate", 2), output = node("output.pdf", 3);
  rotate.data.parameters.degrees = { source: "loop", name: "currentPage" };
  const edges: BatchEdge[] = [
    { id: "input-loop", source: input.id, target: loop.id, sourceHandle: "pdf", targetHandle: "document" },
    { id: "loop-data", source: loop.id, target: rotate.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "loop-body", source: loop.id, target: rotate.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "loop-output", source: loop.id, target: output.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "loop-after", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, loop, rotate, output], edges);
  assert.equal(plan.blocks.find((item) => item.nodeId === loop.id)?.handlerId, "loop.eachPage");
  assert.deepEqual(plan.blocks.find((item) => item.nodeId === rotate.id)?.parameters.degrees, { source: "loop", name: "currentPage" });
  rotate.data.parameters.degrees = { source: "loop", name: "currentPage" };
  assert.throws(() => compileGraph([input, loop, rotate, output], edges.filter((edge) => edge.id !== "loop-body")), /fuori scope|collega l'ingresso/);
});

test("compiles deferred current-page deletion only inside a loop body", () => {
  const input = node("input.pdf", 0), loop = node("loop.eachPage", 1), remove = node("pdf.delete-pages", 2), output = node("output.pdf", 3);
  remove.data.parameters = { deleteCurrentPage: true };
  const edges: BatchEdge[] = [
    { id: "input-loop", source: input.id, target: loop.id, sourceHandle: "pdf", targetHandle: "document" },
    { id: "loop-data", source: loop.id, target: remove.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "loop-body", source: loop.id, target: remove.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "loop-output", source: loop.id, target: output.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "loop-after", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  assert.equal(compileGraph([input, loop, remove, output], edges).blocks.find((item) => item.nodeId === remove.id)?.version, "1.1.0");
  const outsideOutput = node("output.pdf", 4);
  assert.throws(() => compileGraph([input, remove, outsideOutput], [
    { id: "outside-input", source: input.id, target: remove.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "outside-output", source: remove.id, target: outsideOutput.id, sourceHandle: "pdf", targetHandle: "pdf" },
  ]), /deleteCurrentPage può essere usato solo nel body/);
});

test("compiles forEach item and typed column bindings only within its body", () => {
  const input = node("input.pdf", 0), loop = node("loop.forEach", 1), rotate = node("pdf.rotate", 2), output = node("output.pdf", 3);
  loop.data.parameters = {
    source: { source: "api", name: "rows" }, itemType: "object",
    columns: [{ name: "angle", type: "number" }, { name: "caption", type: "string" }], maxIterations: 25,
  };
  rotate.data.parameters.degrees = { source: "loop", name: "item", path: ["angle"] };
  const edges: BatchEdge[] = [
    { id: "input-body", source: input.id, target: rotate.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "loop-body", source: loop.id, target: rotate.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "input-output", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "loop-after", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, loop, rotate, output], edges, { apiParameters: ["rows"], apiParameterTypes: { rows: "json" } });
  assert.equal(plan.blocks.find((item) => item.nodeId === loop.id)?.handlerId, "loop.forEach");
  assert.deepEqual(plan.blocks.find((item) => item.nodeId === rotate.id)?.parameters.degrees, { source: "loop", name: "item", path: ["angle"] });
  rotate.data.parameters.degrees = { source: "loop", name: "item", path: ["missing"] };
  assert.throws(() => compileGraph([input, loop, rotate, output], edges, { apiParameters: ["rows"], apiParameterTypes: { rows: "json" } }), /variabile loop 'item.missing' fuori scope/);
  rotate.data.parameters.degrees = { source: "loop", name: "item", path: ["caption"] };
  assert.throws(() => compileGraph([input, loop, rotate, output], edges, { apiParameters: ["rows"], apiParameterTypes: { rows: "json" } }), /binding loop fornisce string/);
  rotate.data.parameters.degrees = { source: "loop", name: "index" };
  assert.throws(() => compileGraph([input, loop, rotate, output], edges.filter((edge) => edge.id !== "loop-body"), { apiParameters: ["rows"] }), /fuori scope/);
});

test("compiles an API PDF list through forEach document into per-file operations and output collection", () => {
  const files = node("input.pdf-list", 0), each = node("loop.forEach", 1), metadata = node("pdf.write-metadata", 2), output = node("output.pdf", 3);
  each.data.parameters = {
    source: { source: "node", nodeId: files.id, port: "pdfs" }, itemType: "document", columns: [], maxIterations: 100,
  };
  metadata.data.parameters = {
    author: { source: "api", name: "author" },
    title: { source: "api", name: "title" },
    subject: { source: "api", name: "subject" },
  };
  output.data.parameters.filename = "ignored-for-document-list.pdf";
  const edges: BatchEdge[] = [
    { id: "files-run-loop", source: files.id, target: each.id, sourceHandle: "success", targetHandle: "run", data: { kind: "control" } },
    { id: "loop-current-pdf", source: each.id, target: metadata.id, sourceHandle: "document", targetHandle: "pdf" },
    { id: "loop-body-metadata", source: each.id, target: metadata.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "loop-documents-output", source: each.id, target: output.id, sourceHandle: "documents", targetHandle: "documents" },
    { id: "loop-after-output", source: each.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const apiParameters = ["files", "author", "title", "subject"];
  const plan = compileGraph([files, each, metadata, output], edges, {
    apiParameters,
    apiParameterTypes: { files: "pdf-list", author: "string", title: "string", subject: "string" },
  });
  assert.equal(plan.blocks.find((block) => block.nodeId === each.id)?.version, "1.1.0");
  assert.deepEqual(plan.blocks.find((block) => block.nodeId === each.id)?.parameters.itemType, "document");
  assert.deepEqual(plan.blocks.find((block) => block.nodeId === metadata.id)?.parameters.title, { source: "api", name: "title" });
  assert.deepEqual(plan.controlFlow.loops.find((loop) => loop.nodeId === each.id)?.bodyNodeIds, [metadata.id]);
  assert.throws(() => {
    each.data.parameters.source = { source: "api", name: "files" };
    compileGraph([files, each, metadata, output], edges, { apiParameters, apiParameterTypes: { files: "pdf-list", author: "string", title: "string", subject: "string" } });
  }, /output documentList di un nodo precedente/);
});

test("forEach v1.1 continues to compile QR-code output arrays as object rows", () => {
  const input = node("input.pdf", 0), qr = node("pdf.qr.readAll", 1), each = node("loop.forEach", 2), setter = node("data.setVariable", 3), output = node("output.pdf", 4);
  each.data.parameters = {
    source: { source: "node", nodeId: qr.id, port: "codes" }, itemType: "object",
    columns: [{ name: "page", type: "number" }, { name: "value", type: "string" }, { name: "format", type: "string" }], maxIterations: 100,
  };
  setter.data.parameters = { name: "qrValue", scope: "loop", valueType: "string", value: { source: "loop", name: "item", path: ["value"] } };
  const edges: BatchEdge[] = [
    { id: "input-qr", source: input.id, target: qr.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "qr-loop", source: qr.id, target: each.id, sourceHandle: "success", targetHandle: "run", data: { kind: "control" } },
    { id: "loop-body-setter", source: each.id, target: setter.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "input-output", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "loop-after-output", source: each.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, qr, each, setter, output], edges);
  assert.equal(plan.blocks.find((block) => block.nodeId === each.id)?.version, "1.1.0");
  assert.deepEqual(plan.blocks.find((block) => block.nodeId === each.id)?.parameters.source, { source: "node", nodeId: qr.id, port: "codes" });
  assert.deepEqual(plan.blocks.find((block) => block.nodeId === setter.id)?.parameters.value, { source: "loop", name: "item", path: ["value"] });
});

test("compiles while/repeat loop conditions and scopes iteration only inside body", () => {
  for (const type of ["loop.while", "loop.repeatUntil"]) {
    const input = node("input.pdf", 0), loop = node(type, 1), body = node("logic.if", 2), output = node("output.pdf", 3);
    body.data.parameters = { leftType: "number", rightType: "number", left: 1, right: 1, operator: "eq", caseSensitive: false, nullBehavior: "equalOnly" };
    loop.data.parameters = { maxIterations: 5, condition: { kind: "comparison", leftType: "number", rightType: "number", left: { source: "loop", name: "iteration" }, right: 3, operator: "lt" } };
    const edges: BatchEdge[] = [
      { id: "data", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
      { id: "body", source: loop.id, target: body.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
      { id: "after", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
    ];
    const plan = compileGraph([input, loop, body, output], edges);
    assert.equal(plan.blocks.find((block) => block.nodeId === loop.id)?.handlerId, type);
    body.data.toolId = "logic.conditionGroup";
    body.data.toolVersion = "1.0.0";
    body.data.label = "Condizioni composte";
    body.data.parameters = { condition: { kind: "comparison", leftType: "boolean", rightType: "boolean", left: true, right: true, operator: "eq" } };
    loop.data.parameters.condition = { kind: "comparison", leftType: "boolean", rightType: "boolean", left: { source: "node", nodeId: body.id, port: "boolean" }, right: true, operator: "eq" };
    assert.doesNotThrow(() => compileGraph([input, loop, body, output], edges));
    loop.data.parameters.condition = { kind: "comparison", leftType: "number", rightType: "number", left: { source: "loop", name: "currentPage" }, right: 3, operator: "lt" };
    assert.throws(() => compileGraph([input, loop, body, output], edges), /fuori scope|non definita/);
  }
});

test("compiled controlFlow binds break and continue to the innermost nested loop", () => {
  const input = node("input.pdf", 0), outer = node("loop.while", 1), inner = node("loop.repeatUntil", 2);
  const breaker = node("flow.break", 3), tail = node("logic.if", 4), output = node("output.pdf", 5);
  outer.data.parameters = { maxIterations: 4, condition: { kind: "comparison", leftType: "number", rightType: "number", left: { source: "loop", name: "iteration" }, right: 2, operator: "lt" } };
  inner.data.parameters = { maxIterations: 4, condition: { kind: "comparison", leftType: "number", rightType: "number", left: { source: "loop", name: "iteration" }, right: 2, operator: "gte" } };
  tail.data.parameters = { leftType: "number", rightType: "number", left: 1, right: 1, operator: "eq", caseSensitive: false, nullBehavior: "equalOnly" };
  const edges: BatchEdge[] = [
    { id: "data", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "outer-body", source: outer.id, target: inner.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "inner-body", source: inner.id, target: breaker.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "break-tail", source: breaker.id, target: tail.id, sourceHandle: "break", targetHandle: "run", data: { kind: "control" } },
    { id: "inner-after", source: inner.id, target: tail.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
    { id: "outer-after", source: outer.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, outer, inner, breaker, tail, output], edges);
  assert.equal(plan.controlFlow.loops.find((loop) => loop.nodeId === inner.id)?.parentLoopId, outer.id);
  assert.deepEqual(plan.controlFlow.transfers, [{ nodeId: breaker.id, kind: "break", loopNodeId: inner.id }]);
  const outside = node("flow.continue", 6);
  assert.throws(() => compileGraph([input, outer, inner, breaker, tail, output, outside], edges), /solo nel body di un ciclo/);
});

test("jumpPage is scoped to eachPage and rejects zero or out-of-scope targets", () => {
  const input = node("input.pdf", 0), loop = node("loop.eachPage", 1), jump = node("flow.jumpPage", 2), output = node("output.pdf", 3);
  loop.data.parameters = { start: 1, step: 1, maxIterations: 10 };
  jump.data.parameters = { targetMode: "relative", value: 2 };
  const edges: BatchEdge[] = [
    { id: "input-loop", source: input.id, target: loop.id, sourceHandle: "pdf", targetHandle: "document" },
    { id: "body", source: loop.id, target: jump.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } },
    { id: "output-data", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "after", source: loop.id, target: output.id, sourceHandle: "after", targetHandle: "run", data: { kind: "control" } },
  ];
  const plan = compileGraph([input, loop, jump, output], edges);
  assert.deepEqual(plan.controlFlow.transfers, [{ nodeId: jump.id, kind: "jumpPage", loopNodeId: loop.id }]);
  jump.data.parameters.value = 0;
  assert.throws(() => compileGraph([input, loop, jump, output], edges), /non può essere zero/);
  jump.data.parameters = { targetMode: "relative", value: 1 };
  const whileLoop = node("loop.while", 4);
  whileLoop.data.parameters = { maxIterations: 3, condition: { kind: "comparison", leftType: "number", rightType: "number", left: 0, right: 1, operator: "lt" } };
  const insideWhile = [{ id: "while-body", source: whileLoop.id, target: jump.id, sourceHandle: "body", targetHandle: "run", data: { kind: "control" } } as BatchEdge];
  assert.throws(() => compileGraph([input, whileLoop, jump, output], [...insideWhile, { id: "data2", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" }]), /solo nel body di un ciclo|solo nel body di loop.eachPage/);
});

test("loop-scoped variables require a loop body while workflow variables remain declared", () => {
  const local = node("data.setVariable", 0);
  local.data.parameters = { name: "match", scope: "loop", valueType: "boolean", value: true };
  const localInput = node("input.pdf", 1), localOutput = node("output.pdf", 2);
  assert.throws(() => compileGraph([local, localInput, localOutput], [{ id: "local-pdf", source: localInput.id, target: localOutput.id, sourceHandle: "pdf", targetHandle: "pdf" }]), /solo nel body di un ciclo/);
  const lookup = node("data.lookup", 1), input = node("input.pdf", 2), qr = node("pdf.qr.readAll", 3), output = node("output.pdf", 4);
  lookup.data.parameters = { column: "text", valueType: "string", operator: "contains", value: "INV" };
  const plan = compileGraph([lookup, input, qr, output], [
    { id: "input-qr", source: input.id, target: qr.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "qr-lookup", source: qr.id, target: lookup.id, sourceHandle: "codes", targetHandle: "items" },
    { id: "input-output", source: input.id, target: output.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "lookup-found", source: lookup.id, target: output.id, sourceHandle: "found", targetHandle: "run", data: { kind: "control" } },
    { id: "lookup-not-found", source: lookup.id, target: output.id, sourceHandle: "notFound", targetHandle: "run", data: { kind: "control" } },
  ]);
  assert.equal(plan.blocks.find((item) => item.nodeId === lookup.id)?.handlerId, "data.lookup");
  const metadataLookup = node("data.lookup", 5), metadataReader = node("pdf.read-metadata", 6), metadataInput = node("input.pdf", 7), metadataOutput = node("output.pdf", 8);
  metadataLookup.data.parameters = { column: "title", valueType: "string", operator: "contains", value: "invoice" };
  const metadataPlan = compileGraph([metadataLookup, metadataReader, metadataInput, metadataOutput], [
    { id: "metadata-input", source: metadataInput.id, target: metadataReader.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "metadata-record", source: metadataReader.id, target: metadataLookup.id, sourceHandle: "metadata", targetHandle: "record" },
    { id: "metadata-output", source: metadataInput.id, target: metadataOutput.id, sourceHandle: "pdf", targetHandle: "pdf" },
    { id: "metadata-found", source: metadataLookup.id, target: metadataOutput.id, sourceHandle: "found", targetHandle: "run", data: { kind: "control" } },
    { id: "metadata-not-found", source: metadataLookup.id, target: metadataOutput.id, sourceHandle: "notFound", targetHandle: "run", data: { kind: "control" } },
  ]);
  assert.equal(metadataPlan.blocks.find((item) => item.nodeId === metadataLookup.id)?.handlerId, "data.lookup");
});
