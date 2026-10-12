import { z } from "zod";

export type WorkflowJsonValue = string | number | boolean | null | WorkflowJsonValue[] | { [key: string]: WorkflowJsonValue };

export const workflowJsonValueSchema: z.ZodType<WorkflowJsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(workflowJsonValueSchema),
  z.record(z.string(), workflowJsonValueSchema),
]));

export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  data: z.record(z.string(), workflowJsonValueSchema),
}).passthrough();

export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  sourceHandle: z.string().max(200).nullable().optional(),
  targetHandle: z.string().max(200).nullable().optional(),
  type: z.string().max(80).optional(),
}).passthrough();

export const workflowViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive().max(10),
}).strict();

export const workflowDraftPayloadSchema = z.object({
  expectedRevision: z.number().int().positive(),
  nodes: z.array(workflowNodeSchema).max(200),
  edges: z.array(workflowEdgeSchema).max(500),
  viewport: workflowViewportSchema,
  inputSchema: workflowJsonValueSchema,
  outputSchema: workflowJsonValueSchema,
}).strict().superRefine(({ nodes, edges }, context) => {
  const ids = new Set(nodes.map(({ id }) => id));
  if (ids.size !== nodes.length) context.addIssue({ code: "custom", path: ["nodes"], message: "Gli ID dei nodi devono essere univoci." });
  edges.forEach((edge, index) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) context.addIssue({ code: "custom", path: ["edges", index], message: "Il collegamento fa riferimento a un nodo inesistente." });
  });
});

export const workflowPublicationPayloadSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const workflowRollbackPayloadSchema = z.object({
  workflowVersionId: z.string().uuid(),
}).strict();

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowViewport = z.infer<typeof workflowViewportSchema>;
export type WorkflowDraftPayload = z.infer<typeof workflowDraftPayloadSchema>;
