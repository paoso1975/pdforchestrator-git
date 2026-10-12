import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchRunRequest, getBatchRunFields, missingRequiredRunInputs } from "./batch-run-input";

test("identifies single and ordered PDF list inputs from the published JSON schema", () => {
  const fields = getBatchRunFields({
    type: "object",
    properties: {
      documento: { type: "string", format: "uri", contentMediaType: "application/pdf", description: "PDF sorgente" },
      documenti: { type: "array", items: { type: "string", format: "uri", contentMediaType: "application/pdf", "x-file-reference": true }, minItems: 1, maxItems: 5 },
    },
    required: ["documento", "documenti"],
  });
  assert.deepEqual(fields.map(({ name, kind, required }) => ({ name, kind, required })), [
    { name: "documento", kind: "pdf", required: true },
    { name: "documenti", kind: "pdf-list", required: true },
  ]);
  assert.equal(fields[1].maxItems, 5);
});

test("keeps published defaults, validates required empties, and builds API input with ordered file IDs", () => {
  const fields = getBatchRunFields({
    type: "object",
    properties: {
      documenti: { type: "array", items: { type: "string", contentMediaType: "application/pdf" } },
      nome: { type: "string", default: "risultato.pdf" },
      records: { type: "array", items: { type: "object" } },
    },
    required: ["documenti"],
  });
  const values = { documenti: ["file-1", "file-2"], nome: "risultato finale.pdf", records: [{ testoQR: "abc", nomeQR: "Documento" }] };
  assert.deepEqual(missingRequiredRunInputs(fields, { ...values, documenti: [] }), ["documenti"]);
  assert.deepEqual(missingRequiredRunInputs(fields, values), []);
  assert.deepEqual(buildBatchRunRequest(fields, values), { input: values });
  assert.deepEqual(buildBatchRunRequest(fields, { nome: "risultato.pdf" }), { input: { nome: "risultato.pdf" } });
});
