import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchRunRequest, buildDashboardExecutionRequestPreview, buildPublicBatchRunCurlPreview, getBatchRunFields, missingRequiredRunInputs } from "./batch-run-input";

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

test("keeps integer API fields bounded and marks them as integer in the run form", () => {
  const [field] = getBatchRunFields({ type: "object", properties: { dpi: { type: "integer", minimum: 72, maximum: 1200 } }, required: ["dpi"] });
  assert.equal(field.kind, "number");
  assert.equal(field.integer, true);
  assert.equal(field.minimum, 72);
  assert.equal(field.maximum, 1200);
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

test("public cURL preview signs the exact production request and preserves renamed array fields", () => {
  const request = { input: { documentoIngresso: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", elencoQR: [{ testoQR: "abc", nomeQR: "Documento" }] } };
  const curl = buildPublicBatchRunCurlPreview("batch-prova", request, "run-key-123", "https://api.example.test/");
  assert.match(curl, /PFO_API_URL='https:\/\/api\.example\.test'/);
  assert.match(curl, /PFO_PATH='\/api\/public\/v1\/batches\/batch-prova\/runs'/);
  assert.match(curl, /"documentoIngresso":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/);
  assert.match(curl, /"elencoQR":\[\{\"testoQR\":\"abc\",\"nomeQR\":\"Documento\"\}\]/);
  for (const header of ["X-PFO-Key", "X-PFO-Timestamp", "X-PFO-Nonce", "X-PFO-Content-SHA256", "X-PFO-Signature", "Idempotency-Key"]) {
    assert.match(curl, new RegExp(`--header \\"${header}:`));
  }
  assert.match(curl, /PFO_BODY_SHA256=.*openssl dgst -sha256/);
  assert.match(curl, /PFO_CANONICAL=.*POST.*PFO_PATH.*PFO_TIMESTAMP.*PFO_NONCE.*PFO_BODY_SHA256/);
  assert.ok(curl.includes('openssl dgst -sha256 -hmac "$PFO_SECRET"'));
  assert.match(curl, /PFO_KEY_ID/);
  assert.match(curl, /PFO_SECRET/);
  assert.doesNotMatch(curl, /"secret"\s*:/i);
});
