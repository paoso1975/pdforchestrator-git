import type { BatchEdge, BatchNode, ApiParameter, BatchVariable } from "@/lib/batch-graph";
import { isParameterBinding } from "@/lib/blocks/bindings";
import type { BlockDefinition, BlockPortType } from "@/lib/blocks/registry";
import { validateLogicIfConfiguration } from "@/lib/blocks/logic-if";
import { validateConditionGroupAst } from "@/lib/blocks/condition-group";
import { validateForEachConfiguration } from "@/lib/blocks/for-each";
import { validateJumpPageParameters } from "@/lib/blocks/flow-transfers";

export type InspectorOption = { label: string; valueType: BlockPortType | ApiParameter["type"] | BatchVariable["type"] };

export function getPreviousNodes(nodeId: string, nodes: BatchNode[], edges: BatchEdge[]): BatchNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pending = edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) if (edge.target === current) pending.push(edge.source);
  }
  return nodes.filter((node) => visited.has(node.id) && byId.has(node.id));
}

export function isCompatibleParameterType(schemaType: string | undefined, sourceType: InspectorOption["valueType"]): boolean {
  if (!schemaType || schemaType === "" || schemaType === "object" && sourceType === "json") return true;
  if (schemaType === "string") return sourceType === "string" || sourceType === "file" || sourceType === "pdf" || sourceType === "document";
  if (schemaType === "array") return sourceType === "array" || sourceType === "pdf-list" || sourceType === "json" || sourceType === "documentList";
  return schemaType === sourceType;
}

/** TIFF rasterization accepts an API number binding; integer-ness is enforced by its published schema and runtime. */
export function isApiParameterCompatible(blockType: string, parameterName: string, schemaType: string | undefined, sourceType: InspectorOption["valueType"]): boolean {
  if (blockType === "pdf.convert.tiff" && parameterName === "dpi" && schemaType === "integer") return sourceType === "number";
  return isCompatibleParameterType(schemaType, sourceType);
}

export function getParameterIssues(definition: BlockDefinition, values: Record<string, unknown>): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const name of definition.requiredParameters) {
    if (!Object.hasOwn(values, name) && !Object.hasOwn(definition.defaults, name)) issues[name] = "Parametro obbligatorio.";
  }
  const staticValues = Object.fromEntries(Object.entries(values).filter(([, value]) => !isParameterBinding(value)));
  if (definition.type === "logic.if") {
    for (const key of ["left", "right"]) if (isParameterBinding(values[key])) staticValues[key] = null;
  }
  const conditionIssues = ["logic.conditionGroup", "loop.while", "loop.repeatUntil"].includes(definition.type) ? validateConditionGroupAst(staticValues.condition) : [];
  if (conditionIssues.length) issues.condition = conditionIssues[0];
  const foreachIssues = definition.type === "loop.forEach" ? validateForEachConfiguration({ ...definition.defaults, ...values }) : [];
  if (foreachIssues.length) issues.source = foreachIssues[0];
  const jumpIssues = definition.type === "flow.jumpPage" ? validateJumpPageParameters(values) : [];
  if (jumpIssues.length) issues.value = jumpIssues[0];
  const parsedValues = definition.type === "loop.forEach" ? { ...definition.defaults, ...values } : { ...definition.defaults, ...staticValues };
  const parsed = conditionIssues.length ? null : definition.parametersSchema.safeParse(parsedValues);
  if (parsed && !parsed.success) for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "parameters");
    if (!issues[field]) issues[field] = issue.message;
  }
  if (definition.type === "logic.if") {
    for (const issue of validateLogicIfConfiguration({ ...definition.defaults, ...values })) {
      const field = issue.startsWith("right") ? "right" : issue.startsWith("left") ? "left" : issue.split(":", 1)[0] || "operator";
      if (!issues[field]) issues[field] = issue;
    }
  }
  return issues;
}
