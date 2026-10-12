import { z } from "zod";

export const logicIfValueType = z.enum(["string", "number", "boolean", "array", "object"]);
export const logicIfOperator = z.enum([
  "eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains",
  "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull",
]);

export const logicIfParametersSchema = z.object({
  leftType: logicIfValueType.describe("Tipo atteso per il valore left; il worker verifica anche il valore risolto."),
  rightType: logicIfValueType.describe("Tipo atteso per right; per in/notIn deve essere array."),
  left: z.json().describe("Valore costante o binding tipizzato da parametro API, output precedente o variabile."),
  right: z.json().optional().describe("Secondo valore o binding; non richiesto da isEmpty e isNull."),
  operator: logicIfOperator.describe("Operatore dichiarativo del confronto."),
  caseSensitive: z.boolean().default(false).describe("Applica il confronto sensibile a maiuscole/minuscole per stringhe."),
  nullBehavior: z.enum(["equalOnly", "treatAsEmpty", "reject"]).default("equalOnly").describe("Regola applicata quando un operando è null."),
}).strict();

export type LogicIfParameters = z.infer<typeof logicIfParametersSchema>;

/** Checks the declared operand types without resolving bindings. */
export function validateLogicIfConfiguration(value: Record<string, unknown>): string[] {
  const parsed = logicIfParametersSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`);
  const { leftType, rightType, operator } = parsed.data;
  const unary = operator === "isNull" || operator === "isEmpty";
  const issues: string[] = [];
  if (unary && value.right !== undefined) issues.push(`${operator}: non usa l'operando right.`);
  if (!unary && value.right === undefined) issues.push(`${operator}: l'operando right è obbligatorio.`);
  if (["gt", "gte", "lt", "lte"].includes(operator) && (leftType !== "number" || rightType !== "number")) {
    issues.push(`${operator}: entrambi gli operandi devono essere number.`);
  }
  if (["startsWith", "endsWith"].includes(operator) && (leftType !== "string" || rightType !== "string")) {
    issues.push(`${operator}: entrambi gli operandi devono essere string.`);
  }
  if (["contains", "notContains"].includes(operator)) {
    const valid = leftType === "string" && rightType === "string" || leftType === "array";
    if (!valid) issues.push(`${operator}: richiede string/string oppure array come operando left.`);
  }
  if (["in", "notIn"].includes(operator) && (leftType === "array" || rightType !== "array")) {
    issues.push(`${operator}: left deve essere un valore scalare e right un array.`);
  }
  if (operator === "isEmpty" && !["string", "array", "object"].includes(leftType)) {
    issues.push("isEmpty: left deve essere string, array o object.");
  }
  if (!["eq", "neq", "isNull", "isEmpty", "in", "notIn"].includes(operator) && leftType !== rightType && !(["contains", "notContains"].includes(operator) && leftType === "array")) {
    issues.push(`${operator}: tipi dichiarati incompatibili (${leftType} e ${rightType}).`);
  }
  if (["eq", "neq"].includes(operator) && leftType !== rightType) issues.push(`${operator}: i tipi dichiarati devono coincidere.`);
  for (const side of ["left", "right"] as const) {
    const operandValue = value[side];
    if (operandValue === undefined) continue;
    if (operandValue && typeof operandValue === "object" && !Array.isArray(operandValue) && "source" in operandValue) {
      const binding = operandValue as Record<string, unknown>;
      if (binding.source !== "constant") continue;
      if (!valueMatchesDeclaredType(binding.value, side === "left" ? leftType : rightType)) issues.push(`${side}: il valore costante non corrisponde al tipo dichiarato.`);
      continue;
    }
    if (!valueMatchesDeclaredType(operandValue, side === "left" ? leftType : rightType)) issues.push(`${side}: il valore non corrisponde al tipo dichiarato.`);
  }
  if (["in", "notIn"].includes(operator) && Array.isArray(value.right) && value.right.some((item) => !valueMatchesDeclaredType(item, leftType))) {
    issues.push(`right: ogni elemento deve essere ${leftType}.`);
  }
  return issues;
}

export function valueMatchesDeclaredType(value: unknown, type: string): boolean {
  if (value === null) return true;
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    default: return false;
  }
}
