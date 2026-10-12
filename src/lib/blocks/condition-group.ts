import { z } from "zod";
import { logicIfParametersSchema, validateLogicIfConfiguration } from "@/lib/blocks/logic-if";
import { parameterBindingSchema } from "@/lib/blocks/bindings";

const comparisonAstSchema = logicIfParametersSchema.extend({ kind: z.literal("comparison") }).strict();

export type ConditionAst =
  | z.infer<typeof comparisonAstSchema>
  | { kind: "group"; operator: "AND" | "OR"; conditions: ConditionAst[] }
  | { kind: "not"; condition: ConditionAst };

export const conditionAstSchema: z.ZodType<ConditionAst> = z.lazy(() => z.discriminatedUnion("kind", [
  comparisonAstSchema,
  z.object({ kind: z.literal("group"), operator: z.enum(["AND", "OR"]), conditions: z.array(conditionAstSchema).min(1).max(16) }).strict(),
  z.object({ kind: z.literal("not"), condition: conditionAstSchema }).strict(),
]));

export const conditionGroupParametersSchema = z.object({ condition: conditionAstSchema }).strict();
export const defaultConditionAst: ConditionAst = {
  kind: "group", operator: "AND", conditions: [{
    kind: "comparison", leftType: "string", rightType: "string", left: "", right: "",
    operator: "eq", caseSensitive: false, nullBehavior: "equalOnly",
  }],
};

export function validateConditionGroupAst(value: unknown, limits: { maxDepth?: number; maxConditions?: number; maxNodes?: number } = {}): string[] {
  const maxDepth = limits.maxDepth ?? 8;
  const maxConditions = limits.maxConditions ?? 32;
  const maxNodes = limits.maxNodes ?? 63;
  const preflightErrors: string[] = [];
  const pending: Array<{ node: unknown; depth: number; path: string }> = [{ node: value, depth: 1, path: "condition" }];
  let preflightNodes = 0;
  let preflightComparisons = 0;
  while (pending.length) {
    const current = pending.pop()!;
    preflightNodes++;
    if (current.depth > maxDepth) { preflightErrors.push(`${current.path}: profondità massima ${maxDepth} superata.`); continue; }
    if (preflightNodes > maxNodes) { preflightErrors.push(`Il gruppo supera il limite di ${maxNodes} nodi.`); break; }
    if (!current.node || typeof current.node !== "object" || Array.isArray(current.node)) continue;
    const node = current.node as Record<string, unknown>;
    if (node.kind === "comparison") preflightComparisons++;
    else if (node.kind === "not") pending.push({ node: node.condition, depth: current.depth + 1, path: `${current.path}.condition` });
    else if (node.kind === "group" && Array.isArray(node.conditions)) {
      if (node.conditions.length > 16) { preflightErrors.push(`${current.path}: ogni gruppo ammette al massimo 16 condizioni.`); continue; }
      node.conditions.forEach((child, index) => pending.push({ node: child, depth: current.depth + 1, path: `${current.path}.conditions[${index}]` }));
    }
  }
  if (preflightComparisons > maxConditions) preflightErrors.push(`Il gruppo supera il limite di ${maxConditions} confronti.`);
  if (preflightErrors.length) return [...new Set(preflightErrors)];

  const parsed = conditionAstSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "condition"}: ${issue.message}`);
  let nodes = 0;
  let comparisons = 0;
  const errors: string[] = [];
  const visit = (node: ConditionAst, depth: number, path: string) => {
    nodes++;
    if (depth > maxDepth) { errors.push(`${path}: profondità massima ${maxDepth} superata.`); return; }
    if (nodes > maxNodes) { errors.push(`Il gruppo supera il limite di ${maxNodes} nodi.`); return; }
    if (node.kind === "comparison") {
      comparisons++;
      const comparison = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "kind"));
      for (const issue of validateLogicIfConfiguration(comparison)) errors.push(`${path}: ${issue}`);
      for (const side of ["left", "right"] as const) {
        const operand = comparison[side];
        if (operand && typeof operand === "object" && !Array.isArray(operand) && Object.hasOwn(operand, "source")) {
          const binding = parameterBindingSchema.safeParse(operand);
          if (!binding.success) errors.push(`${path}.${side}: binding non valido (${binding.error.issues[0]?.message ?? "forma sconosciuta"}).`);
        }
      }
      if (comparisons > maxConditions) errors.push(`Il gruppo supera il limite di ${maxConditions} confronti.`);
      return;
    }
    if (node.kind === "not") { visit(node.condition, depth + 1, `${path}.condition`); return; }
    node.conditions.forEach((child, index) => visit(child, depth + 1, `${path}.conditions[${index}]`));
  };
  visit(parsed.data, 1, "condition");
  return [...new Set(errors)];
}
