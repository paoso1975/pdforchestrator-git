import { createHash } from "node:crypto";
import { validateGraphDiagnostics, type BatchEdge, type BatchNode, type GraphDiagnostic } from "@/lib/batch-graph";
import { compileGraph, stableStringify, type CompiledPlan } from "@/lib/blocks/compiler";
import { getBlockDefinition } from "@/lib/blocks/registry";

export type WorkflowCompilation = {
  plan: CompiledPlan | null;
  hash: string;
  diagnostics: GraphDiagnostic[];
  handlerDependencies: Array<{ type: string; version: string; handlerId: string; worker: "python" | "orchestrator" }>;
};

/** Rebuild the plan from persisted graph data; never accept a client-supplied plan as authoritative. */
export function compileWorkflowDraft(draft: { nodes: unknown; edges: unknown; viewport: unknown; inputSchema: unknown; outputSchema: unknown }): WorkflowCompilation {
  const nodes = draft.nodes as unknown as BatchNode[];
  const edges = draft.edges as unknown as BatchEdge[];
  const diagnostics = validateGraphDiagnostics(nodes, edges);

  const dependencies = new Map<string, { type: string; version: string; handlerId: string; worker: "python" | "orchestrator" }>();
  for (const node of nodes) {
    const definition = getBlockDefinition(node.data.toolId, node.data.toolVersion);
    if (!definition || !definition.enabled || !definition.worker.handlerId.trim()) {
      diagnostics.push({ code: "HANDLER_UNAVAILABLE", message: `Il blocco '${node.data.toolId}@${node.data.toolVersion}' non ha un handler abilitato.`, severity: "error", nodeId: node.id });
      continue;
    }
    dependencies.set(`${definition.type}@${definition.version}`, { type: definition.type, version: definition.version, handlerId: definition.worker.handlerId, worker: definition.worker.worker });
  }
  if (diagnostics.length) return { plan: null, hash: "", diagnostics, handlerDependencies: [...dependencies.values()] };

  try {
    const properties = schemaProperties(draft.inputSchema);
    const required = new Set(schemaRequired(draft.inputSchema));
    const apiParameterTypes = Object.fromEntries(Object.entries(properties).flatMap(([name, value]) => {
      const type = value && typeof value === "object" && "type" in value ? value.type : undefined;
      return typeof type === "string" ? [[name, type === "integer" ? "number" : type]] : [];
    }));
    const apiParameterManifest = Object.entries(properties).map(([name, value]) => {
      const spec = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const type = typeof spec.type === "string" ? (spec.type === "integer" ? "number" : spec.type) : "json";
      return { name, type, required: required.has(name), ...(Object.hasOwn(spec, "default") ? { defaultValue: spec.default } : {}) };
    });
    const plan = compileGraph(nodes, edges, { apiParameters: Object.keys(properties), apiParameterTypes, apiParameterManifest });
    const canonicalNodes = [...nodes].sort((a, b) => compareText(a.id, b.id));
    const canonicalEdges = [...edges].sort((a, b) => compareText(`${a.source}\u0000${a.sourceHandle ?? ""}\u0000${a.target}\u0000${a.targetHandle ?? ""}\u0000${a.id ?? ""}`, `${b.source}\u0000${b.sourceHandle ?? ""}\u0000${b.target}\u0000${b.targetHandle ?? ""}\u0000${b.id ?? ""}`));
    const hash = createHash("sha256").update(stableStringify({
      nodes: canonicalNodes, edges: canonicalEdges, viewport: draft.viewport, inputSchema: draft.inputSchema,
      outputSchema: draft.outputSchema, plan,
    }), "utf8").digest("hex");
    return { plan, hash, diagnostics: [], handlerDependencies: [...dependencies.values()].sort((a, b) => compareText(`${a.type}@${a.version}`, `${b.type}@${b.version}`)) };
  } catch (error) {
    const details = error instanceof Error && "diagnostics" in error ? (error as { diagnostics: GraphDiagnostic[] }).diagnostics : [];
    const messages = error instanceof Error && "issues" in error ? (error as { issues: string[] }).issues : [error instanceof Error ? error.message : "Compilazione non riuscita."];
    return { plan: null, hash: "", diagnostics: details.length ? details : messages.map((message) => ({ code: "COMPILE_ERROR", message, severity: "error" as const })), handlerDependencies: [...dependencies.values()] };
  }
}

function schemaProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const properties = (value as Record<string, unknown>).properties;
  return properties && typeof properties === "object" && !Array.isArray(properties) ? properties as Record<string, unknown> : {};
}
function schemaRequired(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const required = (value as Record<string, unknown>).required;
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === "string") : [];
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
