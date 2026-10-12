import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileGraph } from "@/lib/blocks/compiler";
import { validateGraph } from "@/lib/batch-graph";
import type { BatchEdge, BatchNode } from "@/lib/batch-graph";

type IntegrationFixture = {
  nodes: BatchNode[];
  edges: BatchEdge[];
  viewport: { x: number; y: number; zoom: number };
  apiParameters: Array<{ name: string; type: string; description: string; required: boolean }>;
};

function loadFixture(): IntegrationFixture {
  return JSON.parse(readFileSync("worker/tests/fixtures/integration_pipeline.graph.json", "utf8")) as IntegrationFixture;
}

test("integration workflow fixture validates and compiles the published PDF pipeline", () => {
  const fixture = loadFixture();
  assert.deepEqual(validateGraph(fixture.nodes, fixture.edges), []);

  const plan = compileGraph(fixture.nodes, fixture.edges, {
    apiParameters: fixture.apiParameters.map((parameter) => parameter.name),
    apiParameterTypes: Object.fromEntries(fixture.apiParameters.map((parameter) => [parameter.name, parameter.type])),
  });
  const requiredOrder = ["input", "merge", "qr", "if-qr", "delete", "ocr", "normalize", "pdfa", "output"];
  let previousIndex = -1;
  for (const nodeId of requiredOrder) {
    const index = plan.order.indexOf(nodeId);
    assert.ok(index > previousIndex, `Il nodo ${nodeId} deve seguire il precedente nel piano compilato.`);
    previousIndex = index;
  }
  assert.deepEqual(plan.blocks.map((block) => block.handlerId).sort(), [
    "input.pdf-list", "pdf.merge", "pdf.qr.readAll", "logic.if", "pdf.page.delete",
    "pdf.ocr", "pdf.page.normalize", "pdf.convert.pdfa", "pdf.output", "output.pdf",
  ].sort());
  assert.deepEqual(plan.manifest.apiParameters.map((parameter) => parameter.name), ["documents"]);
  assert.equal(plan.blocks.find((block) => block.nodeId === "if-qr")?.parameters.left && typeof plan.blocks.find((block) => block.nodeId === "if-qr")?.parameters.left, "object");
});

test("integration workflow fixture round-trips canvas nodes, edges and viewport", () => {
  const fixture = loadFixture();
  const restored = loadFixture();
  assert.deepEqual(restored.nodes, fixture.nodes);
  assert.deepEqual(restored.edges, fixture.edges);
  assert.deepEqual(restored.viewport, fixture.viewport);
});
