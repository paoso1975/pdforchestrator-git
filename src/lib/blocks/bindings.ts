import { z } from "zod";
import { workflowJsonValueSchema } from "@/lib/workflows/schemas";

const safePathPart = z.string().min(1).max(200).refine((part) => !["__proto__", "prototype", "constructor"].includes(part), "Percorso non consentito.");
const bindingPathSchema = z.array(safePathPart).max(16).optional();

export const expressionSchema: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion("op", [
  z.object({ op: z.literal("literal"), value: workflowJsonValueSchema }).strict(),
  z.object({ op: z.literal("path"), root: z.enum(["api", "nodes", "variables", "loop"]), path: z.array(safePathPart).min(1).max(32) }).strict(),
  z.object({ op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains"]), left: expressionSchema, right: expressionSchema }).strict(),
  z.object({ op: z.enum(["and", "or"]), args: z.array(expressionSchema).min(1).max(32) }).strict(),
  z.object({ op: z.literal("not"), value: expressionSchema }).strict(),
  z.object({ op: z.literal("add"), args: z.array(expressionSchema).min(1).max(32) }).strict(),
  z.object({ op: z.literal("concat"), args: z.array(expressionSchema).min(1).max(32) }).strict(),
  z.object({ op: z.literal("if"), condition: expressionSchema, then: expressionSchema, else: expressionSchema }).strict(),
]));

export const parameterBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("constant"), value: workflowJsonValueSchema }).strict(),
  z.object({ source: z.literal("api"), name: z.string().min(1).max(128), path: bindingPathSchema }).strict(),
  z.object({ source: z.literal("node"), nodeId: z.string().min(1).max(200), port: z.string().min(1).max(200), path: bindingPathSchema }).strict(),
  z.object({ source: z.literal("variable"), name: z.string().min(1).max(128), scope: z.enum(["workflow", "loop"]).optional(), path: bindingPathSchema }).strict(),
  z.object({ source: z.literal("loop"), name: z.string().min(1).max(128), path: bindingPathSchema }).strict(),
  z.object({ source: z.literal("expression"), expression: expressionSchema }).strict(),
]);

export type ParameterBinding = z.infer<typeof parameterBindingSchema>;
export type BindingContext = {
  api: Record<string, unknown>;
  nodes: Record<string, Record<string, unknown>>;
  variables: Record<string, unknown>;
  loop: Record<string, unknown>;
};

export class BindingResolutionError extends Error {
  constructor(message: string) { super(message); this.name = "BindingResolutionError"; }
}

function ownPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const part of path) {
    if (!safePathPart.safeParse(part).success) throw new BindingResolutionError("Il percorso contiene una proprietà non consentita.");
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function evaluateExpression(expression: unknown, context: BindingContext): unknown {
  const parsed = expressionSchema.safeParse(expression);
  if (!parsed.success) throw new BindingResolutionError("Espressione non valida: usare solo gli operatori dichiarativi supportati.");
  let budget = 512;
  const evaluate = (node: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 32) throw new BindingResolutionError("Espressione oltre i limiti di complessità.");
    const expr = node as Record<string, unknown>;
    switch (expr.op) {
      case "literal": return expr.value;
      case "path": return ownPath(context[expr.root as keyof BindingContext], expr.path as string[]);
      case "eq": return evaluate(expr.left, depth + 1) === evaluate(expr.right, depth + 1);
      case "neq": return evaluate(expr.left, depth + 1) !== evaluate(expr.right, depth + 1);
      case "gt": return numeric(evaluate(expr.left, depth + 1)) > numeric(evaluate(expr.right, depth + 1));
      case "gte": return numeric(evaluate(expr.left, depth + 1)) >= numeric(evaluate(expr.right, depth + 1));
      case "lt": return numeric(evaluate(expr.left, depth + 1)) < numeric(evaluate(expr.right, depth + 1));
      case "lte": return numeric(evaluate(expr.left, depth + 1)) <= numeric(evaluate(expr.right, depth + 1));
      case "contains": {
        const left = evaluate(expr.left, depth + 1); const right = evaluate(expr.right, depth + 1);
        if (typeof left === "string" && typeof right === "string") return left.includes(right);
        if (Array.isArray(left)) return left.some((item) => JSON.stringify(item) === JSON.stringify(right));
        throw new BindingResolutionError("L'operatore contains richiede una stringa o un array.");
      }
      case "and": return (expr.args as unknown[]).every((item) => Boolean(evaluate(item, depth + 1)));
      case "or": return (expr.args as unknown[]).some((item) => Boolean(evaluate(item, depth + 1)));
      case "not": return !Boolean(evaluate(expr.value, depth + 1));
      case "add": return (expr.args as unknown[]).reduce<number>((sum, item) => sum + numeric(evaluate(item, depth + 1)), 0);
      case "concat": return (expr.args as unknown[]).map((item) => stringify(evaluate(item, depth + 1))).join("");
      case "if": return evaluate(expr.condition, depth + 1) ? evaluate(expr.then, depth + 1) : evaluate(expr.else, depth + 1);
      default: throw new BindingResolutionError("Operatore espressione non supportato.");
    }
  };
  return evaluate(parsed.data, 0);
}

function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BindingResolutionError("L'operatore numerico richiede numeri finiti.");
  return value;
}

function stringify(value: unknown): string {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (value === null) return "null";
  throw new BindingResolutionError("concat accetta solo valori semplici.");
}

function readPath(value: unknown, path: string[] | undefined): unknown {
  let current = value;
  for (const part of path ?? []) {
    if (!safePathPart.safeParse(part).success) throw new BindingResolutionError("Il percorso contiene una proprietà non consentita.");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined;
      current = current[Number(part)];
    } else if (current && typeof current === "object" && Object.hasOwn(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else return undefined;
  }
  return current;
}

function resolveOne(binding: ParameterBinding, context: BindingContext): unknown {
  switch (binding.source) {
    case "constant": return binding.value;
    case "api": return readPath(context.api[binding.name], binding.path);
    case "node": return readPath(context.nodes[binding.nodeId]?.[binding.port], binding.path);
    case "variable": return readPath(binding.scope === "loop" ? context.loop[binding.name] : context.variables[binding.name], binding.path);
    case "loop": return readPath(context.loop[binding.name], binding.path);
    case "expression": return evaluateExpression(binding.expression, context);
  }
}

export function isParameterBinding(value: unknown): value is ParameterBinding {
  return parameterBindingSchema.safeParse(value).success;
}

export function resolveParameterBindings(value: unknown, context: BindingContext): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "source")) {
      const parsed = parameterBindingSchema.safeParse(value);
      if (!parsed.success) throw new BindingResolutionError(`Binding non valido: ${parsed.error.issues[0]?.message ?? "forma sconosciuta"}.`);
      const result = resolveOne(parsed.data, context);
      if (result === undefined) throw new BindingResolutionError("Il binding non risolve un valore disponibile.");
      return result;
    }
    // Compatibility for existing published graphs that used {$param: "apiName"}.
    if (Object.keys(record).length === 1 && typeof record.$param === "string") {
      if (!Object.hasOwn(context.api, record.$param)) throw new BindingResolutionError(`Parametro API mancante: ${record.$param}.`);
      return context.api[record.$param];
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveParameterBindings(item, context)]));
  }
  if (Array.isArray(value)) return value.map((item) => resolveParameterBindings(item, context));
  return value;
}
