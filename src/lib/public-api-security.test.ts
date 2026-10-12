import assert from "node:assert/strict";
import test from "node:test";
import { hasPdfMagicBytes } from "@/lib/pdf-signature";
import { canonicalJson, isSecurePublicRequest, parseIdempotencyKey, positiveBigIntConfig, positiveIntegerConfig, publicBatchSlugSchema, safeRequestId, versionScopeAllows } from "@/lib/public-api-security";

test("public API enforces HTTPS in production and permits local development", () => {
  assert.equal(isSecurePublicRequest(new Request("http://api.example.test/v1"), "development"), true);
  assert.equal(isSecurePublicRequest(new Request("http://api.example.test/v1"), "production"), false);
  assert.equal(isSecurePublicRequest(new Request("https://api.example.test/v1"), "production"), true);
  assert.equal(isSecurePublicRequest(new Request("http://internal/v1", { headers: { "x-forwarded-proto": "https" } }), "production"), true);
});

test("idempotency keys reject truncation, whitespace and control characters", () => {
  assert.deepEqual(parseIdempotencyKey(null), {});
  assert.deepEqual(parseIdempotencyKey("job:2026.10_12-1"), { key: "job:2026.10_12-1" });
  assert.ok(parseIdempotencyKey("bad key").error);
  assert.ok(parseIdempotencyKey("x".repeat(129)).error);
  assert.equal(safeRequestId("request-123", () => "fallback"), "request-123");
  assert.equal(safeRequestId("secret\nvalue", () => "fallback"), "fallback");
});

test("credential version scopes allow either an explicit published version or a batch-wide grant", () => {
  assert.equal(versionScopeAllows([], "version-a"), true);
  assert.equal(versionScopeAllows(["version-a", "version-b"], "version-b"), true);
  assert.equal(versionScopeAllows(["version-a"], "version-b"), false);
});

test("public batch slugs accept safe URL identifiers and reject malformed selectors", () => {
  assert.equal(publicBatchSlugSchema.parse("invoice-processing-v2"), "invoice-processing-v2");
  assert.equal(publicBatchSlugSchema.safeParse("../other-tenant").success, false);
  assert.equal(publicBatchSlugSchema.safeParse(" ").success, false);
  assert.equal(publicBatchSlugSchema.safeParse("x".repeat(101)).success, false);
});

test("idempotency input comparison is stable across object key ordering", () => {
  assert.equal(canonicalJson({ input: { file: "f1", options: { rotate: 90 } } }), canonicalJson({ input: { options: { rotate: 90 }, file: "f1" } }));
  assert.notEqual(canonicalJson({ input: ["a", "b"] }), canonicalJson({ input: ["b", "a"] }));
});

test("security limits fall back safely for invalid environment configuration", () => {
  assert.equal(positiveIntegerConfig("-1", 10), 10);
  assert.equal(positiveIntegerConfig("not-a-number", 10), 10);
  assert.equal(positiveIntegerConfig("25", 10), 25);
  assert.equal(positiveBigIntConfig("0", BigInt(100)), BigInt(100));
  assert.equal(positiveBigIntConfig("1024", BigInt(100)), BigInt(1024));
});

test("upload PDF signature check accepts only the PDF magic prefix", () => {
  assert.equal(hasPdfMagicBytes(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(hasPdfMagicBytes(new TextEncoder().encode("not a PDF")), false);
  assert.equal(hasPdfMagicBytes(new Uint8Array([0x25, 0x50, 0x44])), false);
});
