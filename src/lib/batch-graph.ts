import type { Connection, Edge, Node } from "@xyflow/react";
import { getBlockDefinition } from "@/lib/blocks/registry";
import { isParameterBinding } from "@/lib/blocks/bindings";
import { validateConditionGroupAst } from "@/lib/blocks/condition-group";
import { validateForEachConfiguration } from "@/lib/blocks/for-each";
import { validateJumpPageParameters } from "@/lib/blocks/flow-transfers";

export type BatchNodeData = {
  toolId: string;
  toolVersion: string;
  label: string;
  parameters: Record<string, unknown>;
};
export type BatchNode = Node<BatchNodeData>;
export type BatchEdge = Edge<{ kind: "data" | "control"; label?: string; routing?: "smoothstep" | "bezier" }>;
export type BatchViewport = { x: number; y: number; zoom: number };
export type BatchVariable = { name: string; type: "string" | "number" | "boolean" | "object" | "array"; defaultValue?: unknown };
export type GraphDiagnostic = { code: string; message: string; severity: "error"; nodeId?: string; edgeId?: string };

export type ApiParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "file" | "pdf" | "pdf-list" | "json" | "array";
  description: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: unknown[];
  itemType?: "string" | "number" | "boolean" | "object" | "array";
  itemsSchema?: Record<string, unknown>;
  arrayColumns?: ApiArrayColumn[];
  /** Original block binding name when the public API field was renamed. */
  sourceName?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  inferred?: boolean;
  minimum?: number;
  maximum?: number;
  /** Keep JSON Schema's integer constraint while exposing a numeric API parameter. */
  integer?: boolean;
};

export type ApiArrayColumn = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  defaultValue?: unknown;
};

export function apiArrayColumnsToSchema(columns: ApiArrayColumn[]): Record<string, unknown> {
  const properties = Object.fromEntries(columns.map(({ name, type, defaultValue }) => [name, {
    type,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  }]));
  return {
    type: "object",
    properties,
    required: columns.filter((column) => column.required).map((column) => column.name),
    additionalProperties: false,
  };
}

export function createNode(toolId: string, position: { x: number; y: number }, version?: string): BatchNode | null {
  const tool = getBlockDefinition(toolId, version);
  if (!tool) return null;
  return {
    id: crypto.randomUUID(),
    type: "tool",
    position,
    data: { toolId, toolVersion: tool.version, label: tool.label, parameters: {} },
  };
}

export function canConnect(connection: Connection | { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null; data?: { kind?: "data" | "control" } }, nodes: BatchNode[], edges: BatchEdge[]) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target && edge.sourceHandle === connection.sourceHandle && edge.targetHandle === connection.targetHandle)) return false;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  const sourceTool = getBlockDefinition(source.data.toolId, source.data.toolVersion);
  const targetTool = getBlockDefinition(target.data.toolId, target.data.toolVersion);
  const output = sourceTool?.outputs.find((port) => port.id === connection.sourceHandle);
  const input = targetTool?.inputs.find((port) => port.id === connection.targetHandle);
  const inferredKind = output?.type === "control" || input?.type === "control" ? "control" : "data";
  const edgeKind = ("data" in connection ? connection.data?.kind : undefined) ?? inferredKind;
  if (edgeKind !== inferredKind) return false;
  const compatible = Boolean(output && input && (output.type === "control" && input.type === "control" ||
    output.type === input.type ||
    (input.type === "documentList" && input.multiple && output.type === "document")
  ));
  if (!output || !input || !compatible) return false;
  if (!input.multiple && edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle && (edge.data?.kind ?? inferEdgeKind(edge, nodes)) === edgeKind)) return false;

  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, { source: connection.source, target: connection.target } as BatchEdge]) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (hasCycle(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return !nodes.some((node) => hasCycle(node.id));
}

export function connectionKind(connection: Pick<Connection, "source" | "target" | "sourceHandle" | "targetHandle">, nodes: BatchNode[]): "data" | "control" | null {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const output = source && getBlockDefinition(source.data.toolId, source.data.toolVersion)?.outputs.find((port) => port.id === connection.sourceHandle);
  const input = target && getBlockDefinition(target.data.toolId, target.data.toolVersion)?.inputs.find((port) => port.id === connection.targetHandle);
  if (!output || !input) return null;
  if (output.type === "control" && input.type === "control") return "control";
  if (output.type === "control" || input.type === "control") return null;
  return output.type === input.type || (output.type === "document" && input.type === "documentList" && input.multiple) ? "data" : null;
}

export function makeBatchEdge(connection: Connection, nodes: BatchNode[], options: { routing?: "smoothstep" | "bezier"; animated?: boolean; label?: string } = {}): BatchEdge | null {
  const kind = connectionKind(connection, nodes);
  if (!kind) return null;
  const source = nodes.find((node) => node.id === connection.source);
  const sourcePort = source && getBlockDefinition(source.data.toolId, source.data.toolVersion)?.outputs.find((port) => port.id === connection.sourceHandle);
  const label = options.label ?? (kind === "control" ? sourcePort?.label : undefined);
  return {
    ...connection,
    id: crypto.randomUUID(),
    type: "batch",
    animated: options.animated ?? false,
    data: { kind, routing: options.routing ?? "smoothstep", ...(label ? { label } : {}) },
    markerEnd: { type: "arrowclosed", color: kind === "control" ? "#f1b86d" : "#4079cf", width: 18, height: 18 },
    style: { stroke: kind === "control" ? "#f1b86d" : "#4079cf", strokeWidth: kind === "control" ? 2 : 1.7, ...(kind === "control" ? { strokeDasharray: "5 4" } : {}) },
  };
}

export function reconnectBatchEdge(edge: BatchEdge, connection: Connection, nodes: BatchNode[], edges: BatchEdge[]): BatchEdge | null {
  const remaining = edges.filter((item) => item.id !== edge.id);
  if (!canConnect(connection, nodes, remaining)) return null;
  const replacement = makeBatchEdge(connection, nodes, { routing: edge.type === "bezier" ? "bezier" : "smoothstep", animated: edge.animated, label: edge.data?.label });
  return replacement ? { ...replacement, id: edge.id } : null;
}

export function insertNodeOnBatchEdge(edge: BatchEdge, toolId: string, position: { x: number; y: number }, nodes: BatchNode[], edges: BatchEdge[]): { node: BatchNode; edges: BatchEdge[] } | null {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  const sourcePort = getBlockDefinition(source.data.toolId, source.data.toolVersion)?.outputs.find((port) => port.id === edge.sourceHandle);
  const targetPort = getBlockDefinition(target.data.toolId, target.data.toolVersion)?.inputs.find((port) => port.id === edge.targetHandle);
  if (!sourcePort || !targetPort) return null;
  const inserted = createNode(toolId, position);
  if (!inserted) return null;
  const definition = getBlockDefinition(inserted.data.toolId, inserted.data.toolVersion);
  const matchingInput = definition?.inputs.find((port) => sourcePort.type === port.type || (sourcePort.type === "document" && port.type === "documentList" && port.multiple));
  const matchingOutput = definition?.outputs.find((port) => port.type === targetPort.type || (port.type === "document" && targetPort.type === "documentList" && targetPort.multiple));
  if (!matchingInput || !matchingOutput) return null;
  const first = makeBatchEdge({ source: source.id, target: inserted.id, sourceHandle: sourcePort.id, targetHandle: matchingInput.id }, [...nodes, inserted], { routing: edge.type === "bezier" ? "bezier" : "smoothstep", animated: edge.animated });
  const second = makeBatchEdge({ source: inserted.id, target: target.id, sourceHandle: matchingOutput.id, targetHandle: targetPort.id }, [...nodes, inserted], { routing: edge.type === "bezier" ? "bezier" : "smoothstep", animated: edge.animated });
  if (!first || !second) return null;
  const remaining = edges.filter((item) => item.id !== edge.id);
  if (!canConnect(first, [...nodes, inserted], remaining) || !canConnect(second, [...nodes, inserted], [...remaining, first])) return null;
  return { node: inserted, edges: [...remaining, first, second] };
}

export function validateGraph(nodes: BatchNode[], edges: BatchEdge[]) {
  const issues: string[] = [];
  if (!nodes.some((node) => node.data.toolId === "input.pdf" || node.data.toolId === "input.pdf-list")) issues.push("Aggiungi un nodo Input PDF.");
  const outputTypes = ["output.pdf", "pdf.output", "pdf.output.apiName", "output.tiff.pages", "output.tiff.multipage", "output.tiff.createMultipage"];
  if (!nodes.some((node) => outputTypes.includes(node.data.toolId))) issues.push("Aggiungi un blocco di output.");
  for (const node of nodes) {
    const tool = getBlockDefinition(node.data.toolId, node.data.toolVersion);
    if (!tool) { issues.push(`${node.data.label}: strumento non disponibile.`); continue; }
    for (const port of tool.inputs) {
      if (port.required && !edges.some((edge) => edge.target === node.id && edge.targetHandle === port.id)) issues.push(`${node.data.label}: collega l'ingresso "${port.id}".`);
    }
    const parameters = Object.fromEntries(Object.entries(node.data.parameters).filter(([, value]) => !isParameterBinding(value) && !(value && typeof value === "object" && Object.keys(value).length === 1 && "$param" in value)));
    if (tool.type === "logic.if") {
      for (const key of ["left", "right"]) if (isParameterBinding(node.data.parameters[key])) parameters[key] = null;
    }
    if (tool.type === "data.setVariable" && isParameterBinding(node.data.parameters.value)) {
      const type = node.data.parameters.valueType;
      parameters.value = type === "string" ? "" : type === "number" ? 0 : type === "boolean" ? false : type === "array" ? [] : {};
    }
    if (tool.type === "pdf.page.delete") {
      const placeholders: Record<string, unknown> = { page: 1, pages: [1], pageId: "0000000000000000:page:1" };
      for (const key of Object.keys(placeholders)) if (isParameterBinding(node.data.parameters[key])) parameters[key] = placeholders[key];
    }
    if (tool.type === "pdf.qr.removeMatchedPages" && isParameterBinding(node.data.parameters.records)) parameters.records = [{ testoQR: "QR", nomeQR: "Documento" }];
    if (tool.type === "pdf.output.apiName" && isParameterBinding(node.data.parameters.filename)) parameters.filename = "Output.pdf";
    if (tool.type === "output.tiff.createMultipage" && isParameterBinding(node.data.parameters.filename)) parameters.filename = "Output.tiff";
    if (tool.type === "pdf.bookmark.add") {
      if (isParameterBinding(node.data.parameters.page)) parameters.page = 1;
      if (isParameterBinding(node.data.parameters.description)) parameters.description = "Segnalibro";
    }
    if (tool.type === "loop.forEach" && isParameterBinding(node.data.parameters.source)) parameters.source = node.data.parameters.source;
    for (const required of tool.requiredParameters) {
      if (!Object.hasOwn(node.data.parameters, required) && !Object.hasOwn(tool.defaults, required)) issues.push(`${node.data.label}: ${required}: campo obbligatorio.`);
    }
    const conditionIssues = ["logic.conditionGroup", "loop.while", "loop.repeatUntil"].includes(tool.type) ? validateConditionGroupAst(parameters.condition) : [];
    if (conditionIssues.length) issues.push(...conditionIssues.map((issue) => `${node.data.label}: ${issue}`));
    if (tool.type === "loop.forEach") issues.push(...validateForEachConfiguration({ ...tool.defaults, ...node.data.parameters }, tool.version !== "1.0.0", tool.version === "1.2.0").map((issue) => `${node.data.label}: ${issue}`));
    if (tool.type === "loop.forEach" && tool.version === "1.2.0") {
      const pdfsEdges = edges.filter((edge) => edge.target === node.id && edge.targetHandle === "pdfs");
      if (node.data.parameters.itemType === "document" && pdfsEdges.length !== 1) issues.push(`${node.data.label}: itemType document richiede una PDF LIST collegata alla porta pdfs.`);
      if (node.data.parameters.itemType !== "document" && pdfsEdges.length) issues.push(`${node.data.label}: collega pdfs solo quando itemType è document.`);
    }
    if (tool.type === "flow.jumpPage") issues.push(...validateJumpPageParameters(node.data.parameters).map((issue) => `${node.data.label}: ${issue}`));
    const parsed = conditionIssues.length ? null : tool.parametersSchema.safeParse({ ...tool.defaults, ...parameters });
    if (parsed && !parsed.success) for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "parametri";
      issues.push(`${node.data.label}: ${path}: ${issue.message}`);
    }
  }
  if (nodes.length && !isAcyclic(nodes, edges)) issues.push("Il grafo contiene un ciclo: deve essere un DAG.");
  issues.push(...validateStructure(nodes, edges));
  issues.push(...validateTopology(nodes, edges));
  return [...new Set(issues)];
}

export function validateGraphDiagnostics(nodes: BatchNode[], edges: BatchEdge[]): GraphDiagnostic[] {
  return validateGraph(nodes, edges).map((message) => {
    const edgeMatch = message.match(/Collegamento non valido: (.+) → (.+)\./);
    const edge = (edgeMatch && edges.find((item) => item.source === edgeMatch[1] && item.target === edgeMatch[2])) ?? edges.find((item) => item.id && message.includes(`(${item.id})`));
    const node = nodes.find((item) => item.data?.label && message.startsWith(`${item.data.label}:`)) ??
      nodes.find((item) => message.includes(`'${item.id}'`) || message.includes(`(${item.id})`));
    const code = message.includes("Il grafo contiene un ciclo") ? "GRAPH_CYCLE" : message.includes("non raggiungibile") ? "NODE_UNREACHABLE" :
      message.includes("loop") ? "INVALID_LOOP_SCOPE" : message.includes("terminale") || message.includes("raggiunge un output") ? "INVALID_TERMINAL" :
      message.includes("ramo") ? "INVALID_BRANCH" :
      message.includes("Collegamento") ? "INVALID_EDGE" : message.includes("ingresso") ? "MISSING_INPUT" : "INVALID_GRAPH";
    return { code, message, severity: "error" as const, ...(node ? { nodeId: node.id } : {}), ...(edge ? { edgeId: edge.id } : {}) };
  }).filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code && candidate.nodeId === item.nodeId && candidate.edgeId === item.edgeId && candidate.message === item.message) === index);
}

function validateTopology(nodes: BatchNode[], edges: BatchEdge[]): string[] {
  const issues: string[] = [];
  if (!nodes.length) return issues;
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) issues.push(`Nodo duplicato '${node.id}'.`);
    ids.add(node.id);
  }
  const inputs = nodes.filter((node) => ["input.pdf", "input.pdf-list"].includes(node.data.toolId));
  const outputIds = new Set(nodes.filter((node) => ["output.pdf", "pdf.output", "pdf.output.apiName", "output.tiff.pages", "output.tiff.multipage", "output.tiff.createMultipage"].includes(node.data.toolId)).map((node) => node.id));
  const transfers = new Set(nodes.filter((node) => ["flow.break", "flow.continue", "flow.jumpPage"].includes(node.data.toolId)).map((node) => node.id));
  const loopTypes = new Set(["loop.eachPage", "loop.forEach", "loop.while", "loop.repeatUntil"]);
  const branchTypes = new Set(["logic.if", "logic.conditionGroup", "flow.condition"]);
  const outgoing = (id: string) => edges.filter((edge) => edge.source === id);
  const incoming = (id: string) => edges.filter((edge) => edge.target === id);

  for (const node of inputs) if (incoming(node.id).length) issues.push(`${node.data.label}: un nodo di input deve essere un nodo di avvio e non può avere collegamenti in ingresso (${node.id}).`);
  for (const node of nodes) {
    const definition = getBlockDefinition(node.data.toolId, node.data.toolVersion);
    if (!definition) continue;
    const next = outgoing(node.id);
    if (loopTypes.has(node.data.toolId)) {
      for (const port of ["body", "after"]) if (!next.some((edge) => edge.sourceHandle === port)) issues.push(`${node.data.label}: il loop deve collegare il ramo '${port}' (${node.id}).`);
    }
    if (branchTypes.has(node.data.toolId)) {
      const branches = next.filter((edge) => edge.data?.kind === "control" || inferEdgeKind(edge, nodes) === "control");
      if (branches.length && branches.some((edge) => !["true", "false"].includes(edge.sourceHandle ?? ""))) {
        const invalid = branches.find((edge) => !["true", "false"].includes(edge.sourceHandle ?? ""))!;
        issues.push(`${node.data.label}: il collegamento IF deve partire dal ramo true o false (${invalid.id ?? `${invalid.source}->${invalid.target}`}).`);
      }
    }
    if (outputIds.has(node.id) && next.length) issues.push(`${node.data.label}: un nodo output è terminale e non deve avere collegamenti in uscita (${node.id}).`);
  }

  const validEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const rootControlIds = new Set(nodes.filter((node) => ["logic.if", "logic.conditionGroup", "loop.while", "loop.repeatUntil", "loop.forEach"].includes(node.data.toolId) && incoming(node.id).length === 0).map((node) => node.id));
  const roots = new Set([...inputs.map((node) => node.id), ...rootControlIds]);
  const reachable = new Set<string>();
  const pending = [...roots].sort();
  while (pending.length) {
    const id = pending.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of validEdges.filter((item) => item.source === id).sort(compareEdges)) if (!reachable.has(edge.target)) pending.push(edge.target);
  }
  for (const node of nodes) if (!reachable.has(node.id)) issues.push(`${node.data.label}: nodo non raggiungibile da un nodo di avvio (${node.id}).`);

  const terminalIds = new Set([...outputIds, ...transfers]);
  const implicitLoopBodyIds = new Set<string>();
  for (const loop of nodes.filter((node) => loopTypes.has(node.data.toolId))) {
    const body = reachableFrom(loop.id, validEdges, "body");
    const after = reachableFrom(loop.id, validEdges, "after");
    for (const id of body) if (!after.has(id)) implicitLoopBodyIds.add(id);
  }
  const canReachTerminal = new Set<string>();
  const reversePending = [...terminalIds].sort();
  while (reversePending.length) {
    const id = reversePending.shift()!;
    if (canReachTerminal.has(id)) continue;
    canReachTerminal.add(id);
    for (const edge of validEdges.filter((item) => item.target === id).sort(compareEdges)) if (!canReachTerminal.has(edge.source)) reversePending.push(edge.source);
  }
  for (const node of nodes) if (!canReachTerminal.has(node.id) && !implicitLoopBodyIds.has(node.id)) issues.push(`${node.data.label}: il nodo non raggiunge un output terminale o un trasferimento di ciclo (${node.id}).`);

  for (const node of nodes) {
    if (outgoing(node.id).length || outputIds.has(node.id) || transfers.has(node.id) || implicitLoopBodyIds.has(node.id)) continue;
    issues.push(`${node.data.label}: nodo terminale non valido; collega un percorso a un output o a un trasferimento di ciclo (${node.id}).`);
  }
  return issues;
}

function reachableFrom(nodeId: string, edges: BatchEdge[], handle: string): Set<string> {
  const visited = new Set<string>();
  const pending = edges.filter((edge) => edge.source === nodeId && edge.sourceHandle === handle).map((edge) => edge.target).sort();
  while (pending.length) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges.filter((item) => item.source === current).sort(compareEdges)) if (!visited.has(edge.target)) pending.push(edge.target);
  }
  return visited;
}

function compareEdges(a: BatchEdge, b: BatchEdge): number {
  const left = `${a.source}\u0000${a.sourceHandle ?? ""}\u0000${a.target}\u0000${a.targetHandle ?? ""}\u0000${a.id}`;
  const right = `${b.source}\u0000${b.sourceHandle ?? ""}\u0000${b.target}\u0000${b.targetHandle ?? ""}\u0000${b.id}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateStructure(nodes: BatchNode[], edges: BatchEdge[]) {
  const issues: string[] = [];
  const accepted: BatchEdge[] = [];
  for (const edge of edges) {
    if (!canConnect({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, data: { kind: edge.data?.kind ?? inferEdgeKind(edge, nodes) } }, nodes, accepted)) {
      issues.push(`Collegamento non valido: ${edge.source} → ${edge.target}.`);
    } else accepted.push(edge);
  }
  if (nodes.length && !isAcyclic(nodes, accepted)) issues.push("Il grafo contiene un ciclo: deve essere un DAG.");
  return [...new Set(issues)];
}

function isAcyclic(nodes: BatchNode[], edges: BatchEdge[]) {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let count = 0;
  while (queue.length) {
    const id = queue.shift()!;
    count++;
    for (const target of adjacency.get(id) ?? []) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return count === nodes.length;
}

export function makeSchemas(parameters: ApiParameter[]) {
  const properties = Object.fromEntries(parameters.map((parameter) => [parameter.name, {
    type: parameter.type === "file" || parameter.type === "pdf" ? "string" : parameter.type === "pdf-list" || parameter.type === "array" ? "array" : parameter.type === "json" ? "object" : parameter.type === "number" && parameter.integer ? "integer" : parameter.type,
    ...(parameter.type === "file" || parameter.type === "pdf" ? { format: "uri", "x-file-reference": true, ...(parameter.type === "pdf" ? { contentMediaType: "application/pdf" } : {}) } : {}),
    ...(parameter.type === "pdf-list" ? { items: { type: "string", format: "uri", contentMediaType: "application/pdf", "x-file-reference": true }, minItems: 1, uniqueItems: true } : parameter.type === "array" ? { items: parameter.arrayColumns !== undefined ? apiArrayColumnsToSchema(parameter.arrayColumns) : parameter.itemsSchema ?? { type: parameter.itemType ?? "string", ...(parameter.itemType === "object" ? { additionalProperties: true } : {}) }, ...(parameter.minItems === undefined ? {} : { minItems: parameter.minItems }), ...(parameter.maxItems === undefined ? {} : { maxItems: parameter.maxItems }), ...(parameter.uniqueItems === undefined ? {} : { uniqueItems: parameter.uniqueItems }) } : {}),
    ...(parameter.type === "json" ? { additionalProperties: true } : {}),
    description: parameter.description,
    ...(parameter.sourceName ? { "x-source-parameter": parameter.sourceName } : {}),
    ...(parameter.defaultValue === undefined ? {} : { default: parameter.defaultValue }),
    ...(parameter.enumValues?.length ? { enum: parameter.enumValues } : {}),
    ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
    ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
    ...(parameter.pattern === undefined ? {} : { pattern: parameter.pattern }),
  }]));
  return { type: "object", properties, required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name), additionalProperties: false };
}

export function serializeGraph(nodes: BatchNode[], edges: BatchEdge[], viewport?: BatchViewport, variables: BatchVariable[] = []) {
  return {
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, type, data, label, animated, markerEnd }) => ({ id, source, target, sourceHandle, targetHandle, type, data, label, animated, markerEnd })),
    ...(viewport ? { viewport } : {}),
    ...(variables.length ? { variables } : {}),
  };
}

function inferEdgeKind(edge: BatchEdge, nodes: BatchNode[]): "data" | "control" {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const output = source && getBlockDefinition(source.data.toolId, source.data.toolVersion)?.outputs.find((port) => port.id === edge.sourceHandle);
  const input = target && getBlockDefinition(target.data.toolId, target.data.toolVersion)?.inputs.find((port) => port.id === edge.targetHandle);
  return output?.type === "control" || input?.type === "control" ? "control" : "data";
}

export function autoLayout(nodes: BatchNode[], edges: BatchEdge[], options: { horizontalGap?: number; verticalGap?: number } = {}): BatchNode[] {
  const horizontalGap = options.horizontalGap ?? 280;
  const verticalGap = options.verticalGap ?? 140;
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
  }
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      layer.set(child, Math.max(layer.get(child) ?? 0, (layer.get(id) ?? 0) + 1));
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  const slots = new Map<number, number>();
  return nodes.map((node) => {
    const column = layer.get(node.id) ?? 0;
    const row = slots.get(column) ?? 0;
    slots.set(column, row + 1);
    return { ...node, position: { x: column * horizontalGap, y: row * verticalGap } };
  });
}

