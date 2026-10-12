import assert from "node:assert/strict";
import test from "node:test";
import { validateLogicIfConfiguration } from "@/lib/blocks/logic-if";

const valid = { leftType: "number", rightType: "number", left: 2, right: 3, operator: "lt", caseSensitive: false, nullBehavior: "equalOnly" };

test("logic.if accepts declared compatible types and special membership types", () => {
  assert.deepEqual(validateLogicIfConfiguration(valid), []);
  assert.deepEqual(validateLogicIfConfiguration({ ...valid, leftType: "string", rightType: "array", left: "a", operator: "in", right: ["a"] }), []);
  assert.deepEqual(validateLogicIfConfiguration({ ...valid, leftType: "object", left: null, operator: "isNull", right: undefined }), []);
});

test("logic.if reports mixed, incomplete and operator-incompatible declarations", () => {
  assert.ok(validateLogicIfConfiguration({ ...valid, rightType: "string", operator: "eq" }).some((issue) => issue.includes("tipi dichiarati devono coincidere")));
  assert.ok(validateLogicIfConfiguration({ ...valid, leftType: "string", rightType: "number", operator: "gt" }).some((issue) => issue.includes("entrambi gli operandi")));
  assert.ok(validateLogicIfConfiguration({ ...valid, operator: "startsWith", right: undefined }).some((issue) => issue.includes("right è obbligatorio")));
  assert.ok(validateLogicIfConfiguration({ ...valid, operator: "isEmpty", leftType: "boolean", right: undefined }).some((issue) => issue.includes("isEmpty")));
});
