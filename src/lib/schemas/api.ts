import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const roleSchema = z.enum(["OWNER", "ADMIN", "DESIGNER", "OPERATOR", "VIEWER"]);
export const batchStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const batchResponseSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: batchStatusSchema,
  activeVersionId: uuidSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(), z.number(), z.boolean(), z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const batchVariableSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  defaultValue: jsonValueSchema.optional(),
}).strict().superRefine((variable, context) => {
  const value = variable.defaultValue;
  if (value === undefined) return;
  const valid = variable.type === "string" ? typeof value === "string" : variable.type === "number" ? typeof value === "number" && Number.isFinite(value) : variable.type === "boolean" ? typeof value === "boolean" : variable.type === "object" ? Boolean(value && typeof value === "object" && !Array.isArray(value)) : Array.isArray(value);
  if (!valid) context.addIssue({ code: "custom", path: ["defaultValue"], message: `Il default deve essere di tipo ${variable.type}.` });
});

export const batchGraphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    type: z.literal("tool"),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    data: z.object({
      toolId: z.string().min(1),
      toolVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      label: z.string().min(1),
      parameters: z.record(z.string(), jsonValueSchema),
    }).strict(),
  }).strict()).max(200),
  edges: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    type: z.enum(["smoothstep", "bezier", "default", "batch"]).optional(),
    data: z.object({ kind: z.enum(["data", "control"]), label: z.string().max(120).optional(), routing: z.enum(["smoothstep", "bezier"]).optional() }).strict().optional(),
    label: z.string().max(120).optional(),
    animated: z.boolean().optional(),
    markerEnd: jsonValueSchema.optional(),
  }).strict()).max(500),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.05).max(4) }).strict().optional(),
  variables: z.array(batchVariableSchema).max(100).optional(),
}).strict().superRefine((graph, context) => {
  const nodeIds = new Set<string>();
  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: "Gli ID dei nodi devono essere univoci." });
    nodeIds.add(node.id);
  });
  const edgeIds = new Set<string>();
  const variableNames = new Set<string>();
  graph.variables?.forEach((variable, index) => {
    if (variableNames.has(variable.name)) context.addIssue({ code: "custom", path: ["variables", index, "name"], message: "I nomi delle variabili devono essere univoci." });
    variableNames.add(variable.name);
  });
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) context.addIssue({ code: "custom", path: ["edges", index, "id"], message: "Gli ID dei collegamenti devono essere univoci." });
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) context.addIssue({ code: "custom", path: ["edges", index], message: "Ogni collegamento deve riferirsi a nodi presenti." });
    edgeIds.add(edge.id);
  });
});

export const apiObjectSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.unknown()),
  required: z.array(z.string()).default([]),
  additionalProperties: z.literal(false),
}).strict().superRefine((schema, context) => {
  const propertyNames = new Set(Object.keys(schema.properties));
  schema.required.forEach((name, index) => {
    if (!propertyNames.has(name)) context.addIssue({ code: "custom", path: ["required", index], message: `Parametro non definito: ${name}.` });
  });
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!property || typeof property !== "object" || Array.isArray(property)) continue;
    const spec = property as { type?: string; items?: unknown; properties?: Record<string, unknown>; additionalProperties?: unknown; minItems?: number; maxItems?: number; uniqueItems?: boolean; format?: string };
    if (!["string", "number", "integer", "boolean", "object", "array", "null"].includes(spec.type ?? "")) context.addIssue({ code: "custom", path: ["properties", name, "type"], message: "Tipo JSON Schema non supportato." });
    if (spec.type === "array" && spec.items === undefined) context.addIssue({ code: "custom", path: ["properties", name, "items"], message: "Gli array devono dichiarare items." });
    if (spec.type === "object" && spec.properties === undefined && spec.additionalProperties !== true) context.addIssue({ code: "custom", path: ["properties", name], message: "Gli oggetti liberi devono dichiarare additionalProperties: true." });
    if (spec.type === "array" && spec.items && typeof spec.items === "object" && !Array.isArray(spec.items)) {
      const itemSpec = spec.items as { type?: string; format?: string };
      if (!["string", "number", "integer", "boolean", "object", "array", "null"].includes(itemSpec.type ?? "")) context.addIssue({ code: "custom", path: ["properties", name, "items", "type"], message: "Tipo item JSON Schema non supportato." });
    }
  }
});

export const batchCreateSchema = z.object({
  organizationId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2000).nullable().optional(),
}).strict();

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).strict();

export const batchUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["DRAFT", "ARCHIVED"]).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, "Specifica almeno un campo da aggiornare.");

export const batchVersionCreateSchema = z.object({
  graph: batchGraphSchema,
  inputSchema: apiObjectSchema,
  outputSchema: apiObjectSchema,
  toolManifest: jsonValueSchema,
  publish: z.boolean().default(false),
  batchName: z.string().trim().min(1).max(120).optional(),
}).strict();

export const batchDraftWriteSchema = z.object({
  expectedRevision: z.number().int().positive().nullable(),
  graph: batchGraphSchema,
  inputSchema: apiObjectSchema,
  outputSchema: apiObjectSchema,
  batchName: z.string().trim().min(1).max(120),
}).strict();

export const batchDraftResponseSchema = z.object({
  id: uuidSchema,
  batchId: uuidSchema,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  graph: batchGraphSchema,
  inputSchema: apiObjectSchema,
  outputSchema: apiObjectSchema,
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  batchName: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export const batchDraftHistoryItemSchema = z.object({ id: uuidSchema, revision: z.number().int().positive(), batchName: z.string(), createdAt: z.date(), actorId: uuidSchema.nullable() }).strict();
export const batchDraftHistoryDetailSchema = batchDraftHistoryItemSchema.extend({ batchId: uuidSchema, organizationId: uuidSchema, graph: batchGraphSchema, inputSchema: apiObjectSchema, outputSchema: apiObjectSchema }).strict();

export const batchVersionSchema = z.object({
  id: uuidSchema,
  batchId: uuidSchema,
  version: z.number().int().positive(),
  graph: jsonValueSchema,
  inputSchema: jsonValueSchema,
  outputSchema: jsonValueSchema,
  toolManifest: jsonValueSchema,
  publishedAt: z.date().nullable(),
  configHash: z.string(),
  revision: z.number().int().positive().optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

export const toolDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  runtime: z.enum(["NODE", "PYTHON", "CLI"]),
  inputPorts: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() }).strict()),
  outputPorts: z.array(z.object({ name: z.string(), type: z.string() }).strict()),
  parametersSchema: jsonValueSchema,
  timeoutSeconds: z.number().int().positive().max(900),
  resourceClass: z.enum(["small", "standard", "large"]),
  enabled: z.boolean(),
});

export const organizationResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
  role: roleSchema,
});


