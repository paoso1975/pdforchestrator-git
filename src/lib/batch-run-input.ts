export type RunInputField = {
  name: string;
  label: string;
  description: string;
  required: boolean;
  kind: "pdf" | "pdf-list" | "string" | "number" | "boolean" | "json";
  defaultValue?: unknown;
  enumValues?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

type JsonSchemaField = {
  type?: string;
  format?: string;
  contentMediaType?: string;
  "x-file-reference"?: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  items?: JsonSchemaField;
};

export function getBatchRunFields(inputSchema: unknown): RunInputField[] {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return [];
  const schema = inputSchema as { properties?: Record<string, JsonSchemaField>; required?: string[] };
  return Object.entries(schema.properties ?? {}).flatMap(([name, rawProperty]) => {
    if (!rawProperty || typeof rawProperty !== "object" || Array.isArray(rawProperty)) return [];
    const property = rawProperty;
    const isPdf = property.contentMediaType === "application/pdf" || property["x-file-reference"] === true;
    const isPdfList = property.type === "array" && Boolean(property.items && (
      property.items.contentMediaType === "application/pdf" || property.items["x-file-reference"] === true
    ));
    const kind: RunInputField["kind"] = isPdfList ? "pdf-list" : isPdf ? "pdf"
      : property.type === "number" || property.type === "integer" ? "number"
      : property.type === "boolean" ? "boolean"
      : property.type === "object" || property.type === "array" ? "json" : "string";
    return [{
      name,
      label: name,
      description: property.description ?? "",
      required: schema.required?.includes(name) ?? false,
      kind,
      ...(property.default === undefined ? {} : { defaultValue: property.default }),
      ...(property.enum === undefined ? {} : { enumValues: property.enum }),
      ...(property.minimum === undefined ? {} : { minimum: property.minimum }),
      ...(property.maximum === undefined ? {} : { maximum: property.maximum }),
      ...(property.minLength === undefined ? {} : { minLength: property.minLength }),
      ...(property.maxLength === undefined ? {} : { maxLength: property.maxLength }),
      ...(property.minItems === undefined ? {} : { minItems: property.minItems }),
      ...(property.maxItems === undefined ? {} : { maxItems: property.maxItems }),
      ...(property.pattern === undefined ? {} : { pattern: property.pattern }),
    }];
  });
}

export function buildBatchRunRequest(fields: RunInputField[], values: Record<string, unknown>) {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(values, field.name) && values[field.name] !== undefined) input[field.name] = values[field.name];
  }
  return { input };
}

export function buildDashboardExecutionRequestPreview(batchId: string, requestBody: { input: Record<string, unknown> }, idempotencyKey = "<UUID generato prima dell’invio>"): string {
  return [
    `POST /api/batches/${encodeURIComponent(batchId)}/executions`,
    "Content-Type: application/json",
    `Idempotency-Key: ${idempotencyKey}`,
    "Autenticazione: sessione dashboard (cookie same-origin gestito dal browser)",
    "",
    JSON.stringify(requestBody, null, 2),
  ].join("\n");
}

export function missingRequiredRunInputs(fields: RunInputField[], values: Record<string, unknown>): string[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.name];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  }).map((field) => field.name);
}
