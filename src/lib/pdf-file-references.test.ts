import assert from "node:assert/strict";
import test from "node:test";
import { createNode } from "@/lib/batch-graph";
import { generateApiDefinition } from "@/lib/api-schema";
import { collectPdfFileReferences, validatePdfInputFileRecords, type PdfInputFileRecord } from "@/lib/pdf-file-references";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-10-14T12:00:00.000Z");

function record(id: string, overrides: Partial<PdfInputFileRecord> = {}): PdfInputFileRecord {
  return { id, organizationId, credentialId: null, kind: "INPUT", uploadState: "UPLOADED", expiresAt: null, ...overrides };
}

test("collects a single published PDF by contentMediaType and ignores an ordinary UUID string", () => {
  const refs = collectPdfFileReferences({
    documento: firstId,
    correlationId: secondId,
  }, {
    type: "object",
    properties: {
      documento: { type: "string", format: "uri", contentMediaType: "application/pdf" },
      correlationId: { type: "string", format: "uuid" },
    },
  });
  assert.deepEqual(refs, [{ fileId: firstId, path: "input.documento" }]);
  assert.deepEqual(collectPdfFileReferences({ value: firstId }, { type: "object", properties: { value: { type: "string", format: "uri" } } }), []);
});

test("collects every PDF from a published pdf-list schema in input order", () => {
  const refs = collectPdfFileReferences({ documenti: [firstId, secondId] }, {
    type: "object",
    properties: { documenti: { type: "array", items: { type: "string", format: "uri", contentMediaType: "application/pdf", "x-file-reference": true } } },
  });
  assert.deepEqual(refs, [
    { fileId: firstId, path: "input.documenti[0]" },
    { fileId: secondId, path: "input.documenti[1]" },
  ]);
});

test("requires UUIDs at PDF schema leaves and handles missing/foreign/incomplete/expired files explicitly", () => {
  const schema = { type: "object", properties: { documento: { type: "string", contentMediaType: "application/pdf" } } };
  assert.throws(() => collectPdfFileReferences({ documento: "non-uuid" }, schema), /ID UUID/);
  const refs = collectPdfFileReferences({ documento: firstId }, schema);
  assert.equal(validatePdfInputFileRecords(refs, [], { organizationId }).valid, false);
  assert.equal(validatePdfInputFileRecords(refs, [record(firstId, { organizationId: otherOrganizationId })], { organizationId }).valid, false);
  assert.equal(validatePdfInputFileRecords(refs, [record(firstId, { uploadState: "INITIATED" })], { organizationId }).valid, false);
  assert.equal(validatePdfInputFileRecords(refs, [record(firstId, { expiresAt: new Date(now.getTime() - 1) })], { organizationId, now }).valid, false);
  const valid = validatePdfInputFileRecords(refs, [record(firstId, { expiresAt: null })], { organizationId, now });
  assert.equal(valid.valid, true, "a null expiresAt means no expiration");
});

test("extracts separate IDs for multiple input.pdf blocks using their published schema parameters", () => {
  const first = createNode("input.pdf", { x: 0, y: 0 });
  const second = createNode("input.pdf", { x: 0, y: 100 });
  assert.ok(first && second);
  first.data.parameters.parameter = "documentoPrincipale";
  second.data.parameters.parameter = "allegato";
  const { inputSchema } = generateApiDefinition([first, second]);
  const refs = collectPdfFileReferences({ documentoPrincipale: firstId, allegato: secondId }, inputSchema);
  assert.deepEqual(refs.map(({ fileId }) => fileId), [firstId, secondId]);
  assert.equal(refs.length, 2);
});

test("reports a referenced file missing at worker claim instead of returning a partial file list", () => {
  const refs = [{ fileId: firstId, path: "input.documento" }, { fileId: secondId, path: "input.documenti[0]" }];
  const result = validatePdfInputFileRecords(refs, [record(firstId)], { organizationId, now });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.error.code, "FILE_NOT_FOUND");
    assert.equal(result.error.status, 400);
  }
});
