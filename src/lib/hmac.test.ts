import assert from "node:assert/strict";
import test from "node:test";
import { canonicalQuery, canonicalRequest, signRequest } from "@/lib/hmac";

test("canonical query sorts pairs and uses RFC3986 encoding", () => {
  assert.equal(canonicalQuery("z=two%20words&a=x%2Fy&a=%21"), "a=%21&a=x%2Fy&z=two%20words");
});

test("canonical request binds method, path, query, timestamp, nonce and body hash", () => {
  const canonical = canonicalRequest("post", "/v1/jobs", "b=2&a=1", "1790000000", "nonce-A", "AB".repeat(32));
  assert.equal(canonical, `POST\n/v1/jobs\na=1&b=2\n1790000000\nnonce-A\n${"ab".repeat(32)}`);
  const signature = signRequest("example-secret", "POST", "/v1/jobs", "b=2&a=1", "1790000000", "nonce-A", "ab".repeat(32));
  assert.equal(signature.length, 64);
  assert.notEqual(signature, signRequest("example-secret", "GET", "/v1/jobs", "b=2&a=1", "1790000000", "nonce-A", "ab".repeat(32)));
  assert.notEqual(signature, signRequest("example-secret", "POST", "/v1/jobs", "b=2&a=1", "1790000000", "nonce-B", "ab".repeat(32)));
});
