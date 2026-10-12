import assert from "node:assert/strict";
import test from "node:test";
import { createNode } from "@/lib/batch-graph";
import { apiRequestExample, applySchemaDefaults, generateApiDefinition, makeOutputSchema, parametersFromSchema } from "@/lib/api-schema";

function node(type: string, x: number) {
  const result = createNode(type, { x, y: 0 });
  assert.ok(result);
  return result;
}

test("infers required PDF uploads and typed API bindings with defaults and enum constraints", () => {
  const input = node("input.pdf-list", 0);
  const rotate = node("pdf.rotate", 1);
  const convert = node("pdf.convert.pdfa", 2);
  rotate.data.parameters.degrees = { source: "api", name: "rotation" };
  convert.data.parameters.target = { source: "api", name: "profile" };

  const result = generateApiDefinition([convert, rotate, input]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.parameters.map(({ name, type, required }) => ({ name, type, required })), [
    { name: "documenti", type: "pdf-list", required: true },
    { name: "profile", type: "string", required: false },
    { name: "rotation", type: "number", required: false },
  ]);
  assert.deepEqual(result.inputSchema.properties.profile.enum, ["PDF/A-1b", "PDF/A-2b", "PDF/A-3b"]);
  assert.equal(result.inputSchema.properties.profile.default, "PDF/A-2b");
  assert.equal(result.inputSchema.properties.rotation.default, 90);
  assert.equal(result.inputSchema.properties.rotation.type, "number");
  assert.deepEqual((result.inputSchema.properties.documenti as { items?: unknown }).items, { type: "string", format: "uri", contentMediaType: "application/pdf", "x-file-reference": true });
});

test("infers an API array of typed records for a forEach source", () => {
  const each = node("loop.forEach", 0);
  each.data.parameters = {
    source: { source: "api", name: "ElencoQR" },
    itemType: "object",
    columns: [{ name: "testoQR", type: "string" }, { name: "nomeQR", type: "string" }],
    maxIterations: 1000,
  };
  const result = generateApiDefinition([each]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.inputSchema.properties.ElencoQR, {
    type: "array", description: "Elenco di record JSON usato dal ciclo", items: {
      type: "object", properties: { testoQR: { type: "string" }, nomeQR: { type: "string" } },
      required: ["testoQR", "nomeQR"], additionalProperties: false,
    }, minItems: 1, maxItems: 1000,
  });
  assert.deepEqual(result.inputSchema.required, ["ElencoQR"]);
});

test("an API supplied pdf.output filename is required and has no baked-in output default", () => {
  const output = node("pdf.output", 0);
  output.data.parameters.filenameTemplate = { source: "api", name: "FileFinale" };
  const result = generateApiDefinition([output]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.inputSchema.required, ["FileFinale"]);
  assert.equal(result.inputSchema.properties.FileFinale.default, undefined);
});

test("merges repeated names and reports incompatible type and secret-name collisions", () => {
  const first = node("pdf.rotate", 0);
  const second = node("pdf.rotate", 1);
  const secret = node("pdf.rotate", 2);
  first.data.parameters.degrees = { source: "api", name: "amount" };
  second.data.parameters.degrees = { source: "api", name: "amount" };
  secret.data.parameters.degrees = { source: "api", name: "apiToken" };
  const result = generateApiDefinition([first, second, secret], [
    { name: "amount", type: "string", description: "wrong type", required: false },
    { name: "password", type: "string", description: "password", required: true },
  ]);
  assert.equal(result.parameters.filter((parameter) => parameter.name === "amount").length, 1);
  assert.ok(result.issues.some((issue) => issue.code === "TYPE_COLLISION" && issue.parameter === "amount"));
  assert.ok(result.issues.some((issue) => issue.code === "SECRET_INPUT" && issue.parameter === "apiToken"));
  assert.ok(result.issues.some((issue) => issue.code === "SECRET_INPUT" && issue.parameter === "password"));
});

test("round-trips schema parameter types and produces request/curl/response examples without secrets in JSON", () => {
  const parameters = [
    { name: "inputFile", type: "pdf" as const, description: "PDF sorgente", required: true },
    { name: "mode", type: "string" as const, description: "Modalità", required: false, defaultValue: "safe", enumValues: ["safe", "full"] },
    { name: "rows", type: "array" as const, itemType: "object" as const, description: "Righe", required: false },
  ];
  const generated = generateApiDefinition([], parameters);
  const example = apiRequestExample(generated.inputSchema, "batch-uuid");
  assert.equal(example.requestBody.input.inputFile, "00000000-0000-4000-8000-000000000001");
  assert.equal(example.requestBody.input.mode, "safe");
  assert.equal(example.requestBody.input.rows instanceof Array, true);
  assert.match(example.curl, /X-PFO-Signature/);
  assert.doesNotMatch(example.json, /PFO_SECRET|secret/i);
  assert.equal(parametersFromSchema(generated.inputSchema).find((item) => item.name === "inputFile")?.type, "pdf");
  assert.equal(makeOutputSchema().properties.files.type, "array");
});

test("applies declared request defaults before worker inputs are queued", () => {
  const schema = {
    type: "object",
    properties: {
      retries: { type: "number", default: 3 },
      options: { type: "object", properties: { mode: { type: "string", default: "safe" } }, additionalProperties: false },
    },
    required: [],
    additionalProperties: false,
  };
  assert.deepEqual(applySchemaDefaults({ options: {} }, schema), { retries: 3, options: { mode: "safe" } });
});
