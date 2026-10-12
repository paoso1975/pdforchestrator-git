import { z } from "zod";
import { parameterBindingSchema } from "@/lib/blocks/bindings";

const jsonValue = z.json();
const safeColumn = z.string().min(1).max(128).refine((value) => !value.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part)), "Percorso colonna non consentito.");

export const lookupParametersSchema = z.object({
  column: safeColumn,
  valueType: z.enum(["string", "number", "boolean", "object", "array", "null"]),
  operator: z.enum(["exact", "contains", "range"]),
  value: jsonValue.optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  result: z.enum(["column", "object"]).default("object"),
  resultColumn: safeColumn.optional(),
  cardinality: z.enum(["first", "all"]).default("first"),
  defaultValue: jsonValue.optional(),
  nullBehavior: z.enum(["match", "skip", "error"]).default("skip"),
}).strict().superRefine((value, ctx) => {
  if (value.operator === "range" && (value.valueType !== "number" || value.min === undefined && value.max === undefined || value.min !== undefined && value.max !== undefined && value.min > value.max)) ctx.addIssue({ code: "custom", path: ["operator"], message: "range richiede un tipo number e almeno un limite coerente." });
  if (value.operator !== "range" && value.value === undefined) ctx.addIssue({ code: "custom", path: ["value"], message: "Il confronto richiede value." });
  if (value.operator === "contains" && !["string", "array"].includes(value.valueType)) ctx.addIssue({ code: "custom", path: ["valueType"], message: "contains richiede una colonna string o array." });
  if (value.operator === "exact" && value.value !== undefined && value.value !== null && !matches(value.value, value.valueType)) ctx.addIssue({ code: "custom", path: ["value"], message: "value non corrisponde a valueType." });
  if (value.operator === "exact" && value.value === null && value.nullBehavior !== "match") ctx.addIssue({ code: "custom", path: ["value"], message: "Il confronto con null richiede nullBehavior=match." });
});

export const setVariableParametersSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((value) => !["__proto__", "prototype", "constructor"].includes(value)),
  valueType: z.enum(["string", "number", "boolean", "object", "array"]),
  scope: z.enum(["workflow", "loop"]),
  value: z.union([jsonValue, parameterBindingSchema]),
}).strict().superRefine((config, ctx) => {
  if (config.value && typeof config.value === "object" && "source" in config.value) return;
  if (!matches(config.value, config.valueType)) ctx.addIssue({ code: "custom", path: ["value"], message: `value deve essere di tipo ${config.valueType}.` });
});

function matches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}
