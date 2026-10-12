import assert from "node:assert/strict";
import test from "node:test";
import { validateConditionGroupAst, type ConditionAst } from "@/lib/blocks/condition-group";

const comparison = { kind: "comparison", leftType: "number", rightType: "number", left: 3, right: 2, operator: "gt", caseSensitive: false, nullBehavior: "equalOnly" } as const;

test("condition groups accept nested AND, OR and NOT with typed comparisons", () => {
  const ast: ConditionAst = {
    kind: "group", operator: "AND", conditions: [comparison, {
      kind: "not", condition: { kind: "group", operator: "OR", conditions: [
        { ...comparison, operator: "lt" }, { ...comparison, operator: "eq" },
      ] },
    }],
  };
  assert.deepEqual(validateConditionGroupAst(ast), []);
});

test("condition groups reject mixed comparison types, malformed bindings and oversized trees", () => {
  assert.ok(validateConditionGroupAst({ ...comparison, rightType: "string" }).some((issue) => issue.includes("tipi dichiarati")));
  assert.ok(validateConditionGroupAst({ ...comparison, left: { source: "api", name: "" } }).some((issue) => issue.includes("binding non valido")));
  const tooDeep: unknown = Array.from({ length: 9 }, (_, index) => index).reduce<unknown>((condition) => ({ kind: "not", condition }), comparison);
  assert.ok(validateConditionGroupAst(tooDeep).some((issue) => issue.includes("profondità massima 8")));
  const tooMany = { kind: "group", operator: "AND", conditions: Array.from({ length: 3 }, () => ({ kind: "group", operator: "OR", conditions: Array.from({ length: 11 }, () => comparison) })) };
  assert.ok(validateConditionGroupAst(tooMany).some((issue) => issue.includes("limite di 32 confronti")));
});
