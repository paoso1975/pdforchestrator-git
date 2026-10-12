import { z } from "zod";
import { parameterBindingSchema } from "@/lib/blocks/bindings";

export const forEachValueTypeSchema = z.enum(["string", "number", "boolean", "object", "array"]);
export const forEachColumnSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine((name) => !["__proto__", "prototype", "constructor"].includes(name)),
  type: forEachValueTypeSchema,
}).strict();

export const forEachFilterSchema = z.object({
  column: z.string().min(1).max(128),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull"]),
  value: z.json().optional(),
}).strict();

export const forEachParametersSchema = z.object({
  source: parameterBindingSchema.describe("Binding a un array JSON o a una tabella { rows: [...] } (ad esempio codes di pdf.detect-qr)."),
  itemType: forEachValueTypeSchema.default("object").describe("Tipo degli elementi dell'array."),
  columns: z.array(forEachColumnSchema).max(64).default([]).describe("Colonne richieste e tipizzate per accedere a item.nomeColonna nel ramo body."),
  filter: forEachFilterSchema.optional().describe("Filtro dichiarativo applicato prima delle iterazioni; usare $item per elementi semplici."),
  maxIterations: z.number().int().positive().max(1000).default(1000).describe("Numero massimo di elementi elaborati dopo il filtro (da 1 a 1000)."),
}).strict();

export function validateForEachConfiguration(value: unknown): string[] {
  const parsed = forEachParametersSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const { itemType, columns, filter } = parsed.data;
  const names = columns.map((column) => column.name);
  const issues: string[] = [];
  if (new Set(names).size !== names.length) issues.push("Le colonne di item devono avere nomi univoci.");
  if (itemType !== "object" && columns.length) issues.push("Le colonne sono ammesse solo quando itemType è object.");
  if (filter && filter.column !== "$item" && !names.includes(filter.column)) issues.push(`La colonna filtro '${filter.column}' non è dichiarata.`);
  if (filter && itemType !== "object" && filter.column !== "$item") issues.push("Gli elementi semplici si filtrano con la colonna $item.");
  if (filter && itemType === "object" && filter.column === "$item") issues.push("Per gli oggetti il filtro deve indicare una colonna dichiarata.");
  if (filter) {
    const fieldType = itemType === "object" ? columns.find((column) => column.name === filter.column)?.type : itemType;
    if (["gt", "gte", "lt", "lte"].includes(filter.operator) && fieldType !== "number") issues.push(`L'operatore ${filter.operator} richiede una colonna number.`);
    if (["startsWith", "endsWith"].includes(filter.operator) && fieldType !== "string") issues.push(`L'operatore ${filter.operator} richiede una colonna string.`);
    if (["contains", "notContains"].includes(filter.operator) && fieldType !== "string" && fieldType !== "array") issues.push(`L'operatore ${filter.operator} richiede una colonna string o array.`);
    if (["in", "notIn"].includes(filter.operator) && !Array.isArray(filter.value)) issues.push(`L'operatore ${filter.operator} richiede value come array.`);
    if (filter.value !== undefined && !["isNull", "isEmpty", "in", "notIn"].includes(filter.operator) && !(fieldType === "array" && ["contains", "notContains"].includes(filter.operator))) {
      const valueType = filter.value === null ? "null" : Array.isArray(filter.value) ? "array" : typeof filter.value;
      if (fieldType && valueType !== fieldType) issues.push(`Il valore del filtro è ${valueType}, ma la colonna è ${fieldType}.`);
    }
  }
  return issues;
}
