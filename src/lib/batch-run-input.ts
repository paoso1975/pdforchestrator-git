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

export function buildPublicBatchRunCurlPreview(batchSlug: string, requestBody: { input: Record<string, unknown> }, idempotencyKey = "<UUID generato prima dell’invio>", apiBaseUrl = "https://api.pdforchestrator.com"): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const path = `/api/public/v1/batches/${encodeURIComponent(batchSlug)}/runs`;
  const body = JSON.stringify(requestBody);
  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const continuation = "\\";
  return [
    "# Esporta PFO_KEY_ID e PFO_SECRET nell'ambiente. Non inserirli nel body o nel repository.",
    ': "${PFO_KEY_ID:?Imposta PFO_KEY_ID con la Access Key ID}"',
    ': "${PFO_SECRET:?Imposta PFO_SECRET con il Secret della credenziale}"',
    `PFO_API_URL=${shellQuote(baseUrl)}`,
    `PFO_PATH=${shellQuote(path)}`,
    `PFO_BODY=${shellQuote(body)}`,
    `PFO_IDEMPOTENCY_KEY=${shellQuote(idempotencyKey)}`,
    "PFO_TIMESTAMP=$(date +%s)",
    "PFO_NONCE=$(openssl rand -hex 16)",
    "PFO_BODY_SHA256=$(printf '%s' \"$PFO_BODY\" | openssl dgst -sha256 | awk '{print $NF}')",
    "PFO_CANONICAL=$(printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s' 'POST' \"$PFO_PATH\" '' \"$PFO_TIMESTAMP\" \"$PFO_NONCE\" \"$PFO_BODY_SHA256\")",
    "PFO_SIGNATURE=$(printf '%s' \"$PFO_CANONICAL\" | openssl dgst -sha256 -hmac \"$PFO_SECRET\" | awk '{print $NF}')",
    "curl --fail-with-body --request POST \"$PFO_API_URL$PFO_PATH\" \\",
    `  --header "Content-Type: application/json" ${continuation}`,
    `  --header "X-PFO-Key: $PFO_KEY_ID" ${continuation}`,
    `  --header "X-PFO-Timestamp: $PFO_TIMESTAMP" ${continuation}`,
    `  --header "X-PFO-Nonce: $PFO_NONCE" ${continuation}`,
    `  --header "X-PFO-Content-SHA256: $PFO_BODY_SHA256" ${continuation}`,
    `  --header "X-PFO-Signature: $PFO_SIGNATURE" ${continuation}`,
    `  --header "Idempotency-Key: $PFO_IDEMPOTENCY_KEY" ${continuation}`,
    '  --data-binary "$PFO_BODY"',
  ].join("\n");
}

export function missingRequiredRunInputs(fields: RunInputField[], values: Record<string, unknown>): string[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.name];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  }).map((field) => field.name);
}
