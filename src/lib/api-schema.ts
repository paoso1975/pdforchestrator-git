import { z } from "zod";
import { getBlockDefinition } from "@/lib/blocks/registry";
import { isParameterBinding, parameterBindingSchema } from "@/lib/blocks/bindings";
import { apiArrayColumnsToSchema, makeSchemas, type ApiArrayColumn, type ApiParameter, type BatchNode } from "@/lib/batch-graph";

export type ApiSchemaIssue = { code: "SECRET_INPUT" | "TYPE_COLLISION" | "INVALID_NAME" | "INVALID_DEFAULT" | "ARRAY_COLUMNS_REQUIRED"; message: string; parameter?: string; nodeId?: string };
export type ApiDefinition = { parameters: ApiParameter[]; inputSchema: ReturnType<typeof makeSchemas>; issues: ApiSchemaIssue[] };

type JsonSchemaProperty = {
  type?: string;
  format?: string;
  contentMediaType?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

const secretName = /(?:secret|password|passwd|token|credential|(?:api|access|private)[_-]?key)/i;
const safeName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const blockedNames = new Set(["__proto__", "prototype", "constructor"]);

/** Infers the public request contract from input nodes and API bindings, then merges explicit API metadata. */
export function generateApiDefinition(nodes: BatchNode[], configured: ApiParameter[] = []): ApiDefinition {
  const inferred: ApiParameter[] = [];
  const issues: ApiSchemaIssue[] = [];
  const add = (parameter: ApiParameter, nodeId?: string) => {
    if (!safeName.test(parameter.name) || blockedNames.has(parameter.name)) {
      issues.push({ code: "INVALID_NAME", parameter: parameter.name, ...(nodeId ? { nodeId } : {}), message: `Il nome API '${parameter.name}' non è valido. Usa lettere, numeri e underscore; non sono consentite chiavi riservate.` });
      return;
    }
    if (secretName.test(parameter.name)) {
      issues.push({ code: "SECRET_INPUT", parameter: parameter.name, ...(nodeId ? { nodeId } : {}), message: `Il campo '${parameter.name}' sembra contenere un segreto. Secret e credenziali non possono essere inviati nel body dell'API.` });
      return;
    }
    const current = inferred.find((item) => item.name === parameter.name);
    if (current) {
      if (current.type !== parameter.type) issues.push({ code: "TYPE_COLLISION", parameter: parameter.name, ...(nodeId ? { nodeId } : {}), message: `Il parametro '${parameter.name}' è usato con tipi incompatibili (${current.type} e ${parameter.type}).` });
      else {
        if (current.enumValues?.length && parameter.enumValues?.length && JSON.stringify(current.enumValues) !== JSON.stringify(parameter.enumValues)) issues.push({ code: "TYPE_COLLISION", parameter: parameter.name, ...(nodeId ? { nodeId } : {}), message: "Il parametro '" + parameter.name + "' ha enumerazioni incompatibili nei diversi binding." });
        if (current.type === "array" && parameter.arrayColumns) {
          const columns = new Map((current.arrayColumns ?? []).map((column) => [column.name, column]));
          for (const column of parameter.arrayColumns) {
            const existingColumn = columns.get(column.name);
            if (existingColumn && existingColumn.type !== column.type) issues.push({ code: "TYPE_COLLISION", parameter: `${parameter.name}.${column.name}`, ...(nodeId ? { nodeId } : {}), message: `La colonna '${column.name}' dell'array '${parameter.name}' è usata con tipi incompatibili.` });
            else if (!existingColumn) columns.set(column.name, column);
          }
          current.arrayColumns = [...columns.values()];
          current.itemsSchema = apiArrayColumnsToSchema(current.arrayColumns);
        }
        current.required ||= parameter.required;
        if (parameter.minimum !== undefined) current.minimum = Math.max(current.minimum ?? parameter.minimum, parameter.minimum);
        if (parameter.maximum !== undefined) current.maximum = Math.min(current.maximum ?? parameter.maximum, parameter.maximum);
        if (current.minimum !== undefined && current.maximum !== undefined && current.minimum > current.maximum) issues.push({ code: "TYPE_COLLISION", parameter: parameter.name, ...(nodeId ? { nodeId } : {}), message: "I limiti del parametro '" + parameter.name + "' si sovrappongono in modo impossibile." });
      }
      return;
    }
    inferred.push({ ...parameter, inferred: true });
  };

  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const toolId = node.data.toolId;
    const definition = getBlockDefinition(toolId, node.data.toolVersion);
    const parameters = { ...(definition?.defaults ?? {}), ...node.data.parameters };
    if (toolId === "input.pdf" || toolId === "input.pdf-list") {
      const parameterName = parameters.parameter;
      if (typeof parameterName === "string") add({ name: parameterName, type: toolId === "input.pdf" ? "pdf" : "pdf-list", description: toolId === "input.pdf" ? "PDF di ingresso del batch" : "PDF di ingresso, nell'ordine indicato", required: true }, node.id);
    }
    if (!definition) continue;
    if (toolId === "loop.forEach" && isParameterBinding(parameters.source) && parameters.source.source === "api") {
      const columns = Array.isArray(parameters.columns)
        ? parameters.columns.filter((column): column is { name: string; type: string } => Boolean(
          column && typeof column === "object" &&
          typeof (column as { name?: unknown }).name === "string" &&
          typeof (column as { type?: unknown }).type === "string",
        ))
        : [];
      const arrayColumns: ApiArrayColumn[] = columns.map((column) => ({ name: column.name, type: column.type as ApiArrayColumn["type"], required: true }));
      add({ name: parameters.source.name, type: "array", description: "Elenco di record JSON usato dal ciclo", required: true, itemType: "object", minItems: 1, maxItems: typeof parameters.maxIterations === "number" ? parameters.maxIterations : 1000, arrayColumns, itemsSchema: apiArrayColumnsToSchema(arrayColumns) }, node.id);
      parameters.source = null;
    }
    const schema = z.toJSONSchema(definition.parametersSchema, { target: "draft-7" }) as { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
    const visit = (value: unknown, path: string[], expected?: JsonSchemaProperty, declared?: string): void => {
      if (isParameterBinding(value)) {
        const parsed = parameterBindingSchema.safeParse(value);
        if (!parsed.success || parsed.data.source !== "api") return;
        const binding = parsed.data;
        const effective = declared ? declaredSchemaType(declared) : expected;
        const apiType = parameterType(effective);
        const apiSuppliedFilename = toolId === "pdf.output" && path.length === 1 && path[0] === "filenameTemplate";
        const defaultValue = apiSuppliedFilename ? undefined : effective?.default ?? (path.length === 1 ? definition.defaults[path[0]] : undefined);
        const topLevelRequired = path[0] ? schema?.required?.includes(path[0]) ?? true : true;
        const itemSchema = effective?.items ? {
          type: effective.items.type,
          ...(effective.items.properties ? { properties: effective.items.properties } : {}),
          ...(effective.items.required ? { required: effective.items.required } : {}),
          ...(effective.items.additionalProperties === undefined ? {} : { additionalProperties: effective.items.additionalProperties }),
        } : undefined;
        add({ name: binding.name, type: apiType, description: effective?.description ?? descriptionFor(binding.name, path), required: defaultValue === undefined && topLevelRequired, defaultValue, enumValues: effective?.enum, itemType: apiType === "array" ? parameterType(effective?.items) as ApiParameter["itemType"] : undefined, itemsSchema: itemSchema, minItems: effective?.minItems, maxItems: effective?.maxItems, uniqueItems: effective?.uniqueItems, minimum: effective?.minimum, maximum: effective?.maximum, pattern: effective?.pattern }, node.id);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, String(index)], expected?.items));
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        let childExpected = expected?.properties?.[key];
        let childDeclared: string | undefined;
        if ((key === "left" || key === "right") && typeof record[`${key}Type`] === "string") childDeclared = record[`${key}Type`] as string;
        if (path.length === 0) childExpected = schema?.properties?.[key];
        visit(child, [...path, key], childExpected, childDeclared);
      }
    };
    visit(parameters, []);
  }

  const merged: ApiParameter[] = [];
  for (const item of [...inferred, ...configured]) {
    if (!safeName.test(item.name) || blockedNames.has(item.name)) {
      issues.push({ code: "INVALID_NAME", parameter: item.name, message: "Il nome API '" + item.name + "' non è valido. Usa lettere, numeri e underscore; non sono consentite chiavi riservate." });
      continue;
    }
    if (secretName.test(item.name)) {
      issues.push({ code: "SECRET_INPUT", parameter: item.name, message: "Il campo '" + item.name + "' sembra contenere un segreto. Secret e credenziali non possono essere inviati nel body dell'API." });
      continue;
    }
    const current = merged.find((parameter) => parameter.name === item.name);
    if (!current) { merged.push({ ...item }); continue; }
    if (current.type !== item.type) {
      issues.push({ code: "TYPE_COLLISION", parameter: item.name, message: `Il parametro '${item.name}' è definito con tipo ${current.type} ma viene usato come ${item.type}.` });
      continue;
    }
    if (current.defaultValue !== undefined && item.defaultValue !== undefined && JSON.stringify(current.defaultValue) !== JSON.stringify(item.defaultValue)) issues.push({ code: "TYPE_COLLISION", parameter: item.name, message: "Il parametro '" + item.name + "' ha valori default in conflitto." });
    if (current.enumValues?.length && item.enumValues?.length && JSON.stringify(current.enumValues) !== JSON.stringify(item.enumValues)) issues.push({ code: "TYPE_COLLISION", parameter: item.name, message: "Il parametro '" + item.name + "' ha enumerazioni incompatibili." });
    current.required ||= item.required;
    if (item.description) current.description = item.description;
    if (item.defaultValue !== undefined) current.defaultValue = item.defaultValue;
    if (item.enumValues?.length) current.enumValues = item.enumValues;
    if (item.itemsSchema) current.itemsSchema = item.itemsSchema;
    if (item.arrayColumns !== undefined) current.arrayColumns = item.arrayColumns;
    if (item.minItems !== undefined) current.minItems = Math.max(current.minItems ?? item.minItems, item.minItems);
    if (item.maxItems !== undefined) current.maxItems = Math.min(current.maxItems ?? item.maxItems, item.maxItems);
    if (item.uniqueItems !== undefined) current.uniqueItems = item.uniqueItems;
    if (item.pattern) current.pattern = item.pattern;
    if (item.minimum !== undefined) current.minimum = Math.max(current.minimum ?? item.minimum, item.minimum);
    if (item.maximum !== undefined) current.maximum = Math.min(current.maximum ?? item.maximum, item.maximum);
    if (current.minimum !== undefined && current.maximum !== undefined && current.minimum > current.maximum) issues.push({ code: "TYPE_COLLISION", parameter: item.name, message: "I limiti del parametro '" + item.name + "' si sovrappongono in modo impossibile." });
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  for (const parameter of merged) if (parameter.defaultValue !== undefined && !defaultMatchesType(parameter.defaultValue, parameter.type, parameter.enumValues)) {
    issues.push({ code: "INVALID_DEFAULT", parameter: parameter.name, message: "Il default del parametro '" + parameter.name + "' non corrisponde al tipo o all'enumerazione dichiarati." });
  }
  for (const parameter of merged) if (parameter.type === "array" && parameter.arrayColumns) {
    const columnNames = new Set<string>();
    for (const column of parameter.arrayColumns) {
      if (!safeName.test(column.name) || blockedNames.has(column.name)) issues.push({ code: "INVALID_NAME", parameter: `${parameter.name}.${column.name}`, message: `Il nome della colonna '${column.name}' non è valido.` });
      if (columnNames.has(column.name)) issues.push({ code: "INVALID_NAME", parameter: `${parameter.name}.${column.name}`, message: `La colonna '${column.name}' è duplicata nell'array '${parameter.name}'.` });
      columnNames.add(column.name);
      if (column.defaultValue !== undefined && !defaultMatchesColumnType(column.defaultValue, column.type)) issues.push({ code: "INVALID_DEFAULT", parameter: `${parameter.name}.${column.name}`, message: `Il default della colonna '${column.name}' non corrisponde al tipo ${column.type}.` });
    }
  }
  for (const parameter of merged) if (parameter.type === "array" && !parameter.inferred && !parameter.arrayColumns?.length && !parameter.itemsSchema?.properties) {
    issues.push({ code: "ARRAY_COLUMNS_REQUIRED", parameter: parameter.name, message: `Definisci almeno una colonna per l'array '${parameter.name}'.` });
  }
  return { parameters: merged, inputSchema: makeSchemas(merged), issues: dedupeIssues(issues) };
}

export function parametersFromSchema(schema: unknown): ApiParameter[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const record = schema as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(record.properties ?? {}).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const property = raw as JsonSchemaProperty;
    const type = property.contentMediaType === "application/pdf" ? "pdf"
      : property.type === "array" && property.items?.contentMediaType === "application/pdf" ? "pdf-list"
      : (property as JsonSchemaProperty & { "x-file-reference"?: boolean })["x-file-reference"] ? "file"
      : property.type === "array" ? "array"
      : property.type === "object" ? "json"
      : property.type === "number" || property.type === "integer" || property.type === "boolean" ? property.type === "integer" ? "number" : property.type
      : "string";
    const itemsSchema = property.items ? {
      type: property.items.type,
      ...(property.items.properties ? { properties: property.items.properties } : {}),
      ...(property.items.required ? { required: property.items.required } : {}),
      ...(property.items.additionalProperties === undefined ? {} : { additionalProperties: property.items.additionalProperties }),
    } : undefined;
    const arrayColumns: ApiArrayColumn[] | undefined = type === "array" && property.items?.properties
      ? Object.entries(property.items.properties).map(([columnName, rawColumn]) => {
        const column = rawColumn as JsonSchemaProperty;
        const columnType = column.type === "number" || column.type === "integer" ? "number" : column.type === "boolean" ? "boolean" : column.type === "object" ? "object" : column.type === "array" ? "array" : "string";
        return { name: columnName, type: columnType, required: property.items?.required?.includes(columnName) ?? false, ...(column.default === undefined ? {} : { defaultValue: column.default }) };
      })
      : undefined;
    return [{ name, type: type as ApiParameter["type"], description: property.description ?? "", required: record.required?.includes(name) ?? false, defaultValue: property.default, enumValues: property.enum, itemType: type === "array" ? parameterType(property.items) as ApiParameter["itemType"] : undefined, itemsSchema, arrayColumns, minItems: property.minItems, maxItems: property.maxItems, uniqueItems: property.uniqueItems, minimum: property.minimum, maximum: property.maximum, pattern: property.pattern }];
  });
}

export function makeOutputSchema() {
  const file = {
    type: "object",
    properties: { id: { type: "string", format: "uuid" }, filename: { type: "string" }, mimeType: { type: "string" }, sizeBytes: { type: "string", pattern: "^[0-9]+$" }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, nodeId: { type: "string" } },
    required: ["id", "filename", "mimeType", "sizeBytes", "sha256"],
    additionalProperties: false,
  };
  return {
    type: "object" as const,
    properties: {
      files: { type: "array", description: "Artifact associati all'esecuzione completata.", items: file },
      manifest: { type: "object", properties: { count: { type: "integer", minimum: 0 }, totalBytes: { type: "string", pattern: "^[0-9]+$" }, files: { type: "array", items: file } }, required: ["count", "totalBytes", "files"], additionalProperties: false },
    },
    required: ["files", "manifest"],
    additionalProperties: false as const,
  };
}

export function exampleExecutionOutput() {
  const file = { id: "00000000-0000-4000-8000-000000000003", filename: "output.pdf", mimeType: "application/pdf", sizeBytes: "12345", sha256: "0".repeat(64), nodeId: "output" };
  return { files: [file], manifest: { count: 1, totalBytes: "12345", files: [file] } };
}

export function exampleInput(schema: ReturnType<typeof makeSchemas>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(schema.properties)) {
    const property = raw as JsonSchemaProperty;
    if (property.default !== undefined) { result[name] = property.default; continue; }
    if (property.enum?.length) { result[name] = property.enum[0]; continue; }
    if (property.contentMediaType === "application/pdf" || (property as JsonSchemaProperty & { "x-file-reference"?: boolean })["x-file-reference"]) { result[name] = "00000000-0000-4000-8000-000000000001"; continue; }
    if (property.type === "array" && property.items?.contentMediaType === "application/pdf") { result[name] = ["00000000-0000-4000-8000-000000000001"]; continue; }
    result[name] = property.type === "number" || property.type === "integer" ? 1 : property.type === "boolean" ? true : property.type === "array" ? [] : property.type === "object" ? {} : "stringa";
  }
  return result;
}

export function applySchemaDefaults(value: unknown, schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return value;
  const spec = schema as { type?: string; properties?: Record<string, unknown>; items?: unknown; default?: unknown };
  if ((spec.type === "object" || spec.properties) && value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const entries = Object.entries(spec.properties ?? {}).map(([name, childSchema]) => {
      if (!Object.hasOwn(source, name) && childSchema && typeof childSchema === "object" && !Array.isArray(childSchema) && Object.hasOwn(childSchema, "default")) return [name, (childSchema as { default: unknown }).default] as const;
      return Object.hasOwn(source, name) ? [name, applySchemaDefaults(source[name], childSchema)] as const : null;
    }).filter((entry): entry is readonly [string, unknown] => entry !== null);
    return Object.fromEntries([...Object.entries(source), ...entries]);
  }
  if (spec.type === "array" && Array.isArray(value) && spec.items) return value.map((item) => applySchemaDefaults(item, spec.items));
  return value;
}

export function apiRequestExample(schema: ReturnType<typeof makeSchemas>, batchId: string, apiBaseUrl = "https://api.pdforchestrator.com") {
  const input = exampleInput(schema);
  const requestBody = { input };
  const json = JSON.stringify(requestBody, null, 2);
  const curl = [
    "curl -X POST \"" + apiBaseUrl.replace(new RegExp("/+$"), "") + "/v1/batches/" + batchId + "/executions\"",
    "  -H \"Content-Type: application/json\"",
    "  -H \"X-PFO-Key: $PFO_KEY_ID\"",
    "  -H \"X-PFO-Timestamp: $PFO_TIMESTAMP\"",
    "  -H \"X-PFO-Nonce: $PFO_NONCE\"",
    "  -H \"X-PFO-Content-SHA256: $PFO_BODY_SHA256\"",
    "  -H \"X-PFO-Signature: $PFO_SIGNATURE\"",
    "  --data-raw '" + JSON.stringify(requestBody).replace(/'/g, "'\\''") + "'",
  ].join(" \\\n");
  return { input, requestBody, json, curl, response: { id: "00000000-0000-4000-8000-000000000002", status: "QUEUED", statusUrl: "/v1/executions/00000000-0000-4000-8000-000000000002" } };
}

function declaredSchemaType(type: string): JsonSchemaProperty | undefined {
  const mapped: Record<string, JsonSchemaProperty> = { string: { type: "string" }, number: { type: "number" }, boolean: { type: "boolean" }, object: { type: "object" }, array: { type: "array" }, document: { type: "string", format: "uri", contentMediaType: "application/pdf" }, documentList: { type: "array", items: { type: "string", format: "uri", contentMediaType: "application/pdf" } }, json: { type: "object" } };
  return mapped[type];
}

function parameterType(property?: JsonSchemaProperty): ApiParameter["type"] {
  if (property?.contentMediaType === "application/pdf") return "pdf";
  if (property?.type === "array" && property.items?.contentMediaType === "application/pdf") return "pdf-list";
  if (property?.type === "number" || property?.type === "boolean" || property?.type === "array") return property.type;
  if (property?.type === "object") return "json";
  return "string";
}

function descriptionFor(name: string, path: string[]): string {
  return path.length ? `Input per ${path.slice(0, -1).join(".") || name}` : `Input ${name}`;
}

function dedupeIssues(issues: ApiSchemaIssue[]) {
  return issues.filter((issue, index) => issues.findIndex((other) => other.code === issue.code && other.parameter === issue.parameter && other.nodeId === issue.nodeId && other.message === issue.message) === index);
}

function defaultMatchesType(value: unknown, type: ApiParameter["type"], enumValues?: unknown[]): boolean {
  if (enumValues?.length && !enumValues.some((item) => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "pdf" || type === "file") return typeof value === "string" && z.string().uuid().safeParse(value).success;
  if (type === "pdf-list") return Array.isArray(value) && value.every((item) => typeof item === "string" && z.string().uuid().safeParse(item).success);
  if (type === "array") return Array.isArray(value);
  if (type === "json") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === "string";
}

function defaultMatchesColumnType(value: unknown, type: ApiArrayColumn["type"]): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return typeof value === "string";
}
