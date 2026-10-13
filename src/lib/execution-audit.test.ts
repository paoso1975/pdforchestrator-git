import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionRequestString, executionRequestId, safeExecutionLogValue } from "./execution-audit";

test("execution audit redacts credential-like fields and bounds large values", () => {
  const safe = safeExecutionLogValue({ apiKey: "never-log", nested: { password: "never-log-too", value: "visible" } }) as Record<string, unknown>;
  assert.equal(safe.apiKey, "[REDACTED]");
  assert.deepEqual(safe.nested, { password: "[REDACTED]", value: "visible" });
  const large = safeExecutionLogValue({ data: Array.from({ length: 100 }, () => "x".repeat(8_000)) }) as { truncated?: boolean };
  assert.equal(large.truncated, true);
});

test("execution request string persists source, request identity and redacted API input", () => {
  const result = buildExecutionRequestString({ method: "POST", path: "/api/public/v1/batches/test/runs", origin: "API_CREDENTIAL", requestId: "req-123", idempotencyKey: "idem-456", input: { apiToken: "hidden", document: "file-id" } });
  assert.match(result, /^POST \/api\/public\/v1\/batches\/test\/runs/m);
  assert.match(result, /Provenienza: API_CREDENTIAL/);
  assert.match(result, /Request ID: req-123/);
  assert.match(result, /Idempotency-Key: idem-456/);
  assert.match(result, /\[REDACTED\]/);
  assert.doesNotMatch(result, /hidden/);
});

test("request IDs accept safe upstream values and replace malformed values", () => {
  assert.equal(executionRequestId("trace:abc-123"), "trace:abc-123");
  assert.match(executionRequestId("bad header\n"), /^[0-9a-f-]{36}$/i);
});
