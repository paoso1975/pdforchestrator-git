import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchRunRequest, buildDashboardExecutionRequestPreview, getBatchRunFields, missingRequiredRunInputs } from "./batch-run-input";

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

test("previews the authenticated dashboard execution request with all current inputs", () => {
  const preview = buildDashboardExecutionRequestPreview("batch/id", { input: { documenti: ["f1", "f2"], titolo: "finale.pdf" } }, "run-key-123");
  assert.match(preview, /^POST \/api\/batches\/batch%2Fid\/executions/m);
  assert.match(preview, /Idempotency-Key: run-key-123/);
  assert.match(preview, /sessione dashboard/);
  assert.match(preview, /"documenti": \[\s+"f1",\s+"f2"/);
  assert.match(preview, /"titolo": "finale\.pdf"/);
});

test("dashboard request uses the StoredFile ID returned by the available-files API", () => {
  const storedFile = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", filename: "input.pdf", sizeBytes: "2048", sha256: "a".repeat(64), createdAt: "2026-10-14T12:00:00.000Z" };
  const fields = getBatchRunFields({ type: "object", properties: { documento: { type: "string", contentMediaType: "application/pdf" } }, required: ["documento"] });
  const body = buildBatchRunRequest(fields, { documento: storedFile.id });
  assert.deepEqual(body, { input: { documento: storedFile.id } });
});
