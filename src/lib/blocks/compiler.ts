import { z } from "zod";
import { createHash } from "node:crypto";
import { validateGraphDiagnostics, type BatchEdge, type BatchNode, type GraphDiagnostic } from "@/lib/batch-graph";
import { getBlockDefinition } from "@/lib/blocks/registry";
import type { BlockPort } from "@/lib/blocks/registry";
import { isParameterBinding, parameterBindingSchema } from "@/lib/blocks/bindings";
import { validateLogicIfConfiguration, valueMatchesDeclaredType } from "@/lib/blocks/logic-if";
import { validateConditionGroupAst, type ConditionAst } from "@/lib/blocks/condition-group";
import { validateForEachConfiguration } from "@/lib/blocks/for-each";
import { validateJumpPageParameters } from "@/lib/blocks/flow-transfers";
import { lookupParametersSchema, setVariableParametersSchema } from "@/lib/blocks/data-operations";

export type CompiledBlock = {
  nodeId: string;
  type: string;
  version: string;
  handlerId: string;
  worker: "python" | "orchestrator";
  timeoutSeconds: number;
  resourceClass: "small" | "standard" | "large";
  inputs: Array<Pick<BlockPort, "id" | "type" | "required" | "multiple">>;
  outputs: Array<Pick<BlockPort, "id" | "type" | "multiple">>;
  parameters: Record<string, unknown>;
};

export type CompiledLoopRegion = { nodeId: string; type: string; bodyNodeIds: string[]; afterNodeIds: string[]; parentLoopId?: string };
export type CompiledControlTransfer = { nodeId: string; kind: "break" | "continue" | "jumpPage"; loopNodeId: string };
export type PlanParameter = { name: string; type: string; required: boolean; defaultValue?: unknown };
export type CompiledPlan = {
  formatVersion: 2;
  compilerVersion: "2.0.0";
  graphHash: string;
  planHash: string;
  order: string[];
  blocks: CompiledBlock[];
  edges: BatchEdge[];
  controlFlow: { loops: CompiledLoopRegion[]; transfers: CompiledControlTransfer[] };
  manifest: { apiParameters: PlanParameter[]; variables: PlanParameter[]; handlers: Array<Pick<CompiledBlock, "type" | "version" | "handlerId" | "worker" | "timeoutSeconds" | "resourceClass">> };
};

export class BlockCompileError extends Error {
  constructor(public readonly issues: string[], public readonly diagnostics: GraphDiagnostic[] = []) { super(issues.join(" ")); this.name = "BlockCompileError"; }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Il piano contiene un valore non serializzabile in JSON.");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function compileGraph(nodes: BatchNode[], edges: BatchEdge[], options: {
  apiParameters?: string[];
  variables?: string[];
  apiParameterTypes?: Record<string, string>;
  variableTypes?: Record<string, string>;
  apiParameterManifest?: PlanParameter[];
  variableManifest?: PlanParameter[];
} = {}): CompiledPlan {
  nodes = [...nodes].sort((a, b) => compareText(a.id, b.id));
  edges = [...edges].sort(compareEdges);
  const diagnostics = validateGraphDiagnostics(nodes, edges);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors = new Map<string, Set<string>>();
  for (const node of nodes) {
    const seen = new Set<string>(); const pending = edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
    while (pending.length) { const current = pending.pop()!; if (seen.has(current)) continue; seen.add(current); for (const edge of edges) if (edge.target === current) pending.push(edge.source); }
    ancestors.set(node.id, seen);
  }
  const loopScopes = new Set<string>();
  const pageLoopScopes = new Set<string>();
  const loopScopeValues = new Map<string, Map<string, string>>();
  const conditionalLoopBodyNodes = new Map<string, Set<string>>();
  const loopRegionsRaw: Array<{ nodeId: string; type: string; bodyNodeIds: Set<string>; afterNodeIds: Set<string> }> = [];
  for (const loop of nodes.filter((node) => ["loop.eachPage", "loop.forEach", "loop.while", "loop.repeatUntil"].includes(node.data.toolId))) {
    const reachable = (handle: string) => {
      const seen = new Set<string>(); const pending = edges.filter((edge) => edge.source === loop.id && edge.sourceHandle === handle).map((edge) => edge.target);
      while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); for (const edge of edges) if (edge.source === id) pending.push(edge.target); }
      return seen;
    };
    const body = reachable("body"); const after = reachable("after");
    loopRegionsRaw.push({ nodeId: loop.id, type: loop.data.toolId, bodyNodeIds: new Set([...body].filter((id) => !after.has(id))), afterNodeIds: after });
    if (loop.data.toolId === "loop.while" || loop.data.toolId === "loop.repeatUntil") conditionalLoopBodyNodes.set(loop.id, new Set([...body].filter((id) => !after.has(id))));
    const scope = new Map<string, string>();
    if (loop.data.toolId === "loop.while" || loop.data.toolId === "loop.repeatUntil") loopScopeValues.set(loop.id, new Map([["iteration", "number"]]));
    if (loop.data.toolId === "loop.eachPage") {
      scope.set("currentPage", "number"); scope.set("pageId", "string"); scope.set("pageCount", "number"); scope.set("index", "number");
    } else if (loop.data.toolId === "loop.forEach") {
      scope.set("item", "object"); scope.set("index", "number");
      if (loop.data.parameters.itemType === "document") {
        scope.set("item.fileRef", "string"); scope.set("item.filename", "string"); scope.set("item.path", "string");
        scope.set("document", "document");
      }
      const raw = loop.data.parameters.columns;
      if (Array.isArray(raw)) for (const column of raw) {
        if (column && typeof column === "object" && typeof column.name === "string" && typeof column.type === "string") scope.set(`item.${column.name}`, column.type);
      }
    } else { scope.set("iteration", "number"); }
    for (const id of body) if (!after.has(id)) { loopScopes.add(id); if (loop.data.toolId === "loop.eachPage") pageLoopScopes.add(id); loopScopeValues.set(id, scope); }
  }
  const validateBinding = (value: unknown, nodeId: string, label: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => validateBinding(item, nodeId, `${label}[${index}]`)); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "source")) {
      const parsed = parameterBindingSchema.safeParse(value);
      if (!parsed.success) throw new BlockCompileError([`${label}: binding non valido (${parsed.error.issues[0]?.message ?? "forma non riconosciuta"}).`]);
      const binding = parsed.data;
      if (binding.source === "api" && options.apiParameters && !options.apiParameters.includes(binding.name)) throw new BlockCompileError([`${label}: parametro API '${binding.name}' non definito.`]);
      if (binding.source === "node") {
        const source = byId.get(binding.nodeId); const definition = source && getBlockDefinition(source.data.toolId, source.data.toolVersion);
        if ((!ancestors.get(nodeId)?.has(binding.nodeId) && !conditionalLoopBodyNodes.get(nodeId)?.has(binding.nodeId)) || !definition?.outputs.some((port) => port.id === binding.port && port.type !== "control")) throw new BlockCompileError([`${label}: l'output selezionato non è disponibile nello scope del nodo.`]);
      }
      if (binding.source === "variable" && binding.scope !== "loop" && options.variables && !options.variables.includes(binding.name)) throw new BlockCompileError([`${label}: variabile '${binding.name}' non definita.`]);
      if (binding.source === "variable" && binding.scope === "loop" && !loopScopes.has(nodeId)) throw new BlockCompileError([`${label}: variabile loop '${binding.name}' fuori scope.`]);
      if (binding.source === "loop") {
        const scope = loopScopeValues.get(nodeId);
        const scopeType = binding.name === "item" && binding.path?.length ? scope?.get(`item.${binding.path[0]}`) : scope?.get(binding.name);
        if (!scopeType) throw new BlockCompileError([`${label}: variabile loop '${binding.name}${binding.path?.length ? `.${binding.path.join(".")}` : ""}' fuori scope o non definita.`]);
        if (binding.name !== "item" && binding.path?.length) throw new BlockCompileError([`${label}: non è consentito accedere a proprietà di '${binding.name}'.`]);
      }
      if (binding.source === "expression") validateExpressionPaths(binding.expression, nodeId, label, options, byId, ancestors, loopScopes, loopScopeValues);
      return;
    }
    if (Object.keys(record).length === 1 && typeof record.$param === "string") {
      if (options.apiParameters && !options.apiParameters.includes(record.$param)) throw new BlockCompileError([`${label}: parametro API '${record.$param}' non definito.`]);
      return;
    }
    Object.entries(record).forEach(([key, item]) => validateBinding(item, nodeId, `${label}.${key}`));
  };
  const validateDeclaredOperand = (comparison: Record<string, unknown>, nodeId: string, label: string, side: "left" | "right") => {
    const value = comparison[side];
    if (!isParameterBinding(value)) return;
    const declaredType = String(comparison[`${side}Type`]);
    let actualType: string | undefined;
    if ("path" in value && value.path?.length && value.source !== "loop") return;
    if (value.source === "node") {
      const sourceNode = byId.get(value.nodeId);
      const sourceDefinition = sourceNode && getBlockDefinition(sourceNode.data.toolId, sourceNode.data.toolVersion);
      const sourcePort = sourceDefinition?.outputs.find((port) => port.id === value.port);
      actualType = sourcePort?.type === "document" ? "string" : sourcePort?.type === "documentList" ? "array" : sourcePort?.type;
    } else if (value.source === "api") actualType = options.apiParameterTypes?.[value.name];
    else if (value.source === "variable") actualType = options.variableTypes?.[value.name];
    else if (value.source === "loop") {
      const scope = loopScopeValues.get(nodeId);
      actualType = value.path?.length && value.name === "item" ? scope?.get(`item.${value.path[0]}`) : scope?.get(value.name);
    }
    else if (value.source === "constant" && !valueMatchesDeclaredType(value.value, declaredType)) actualType = `incompatibile (${typeof value.value})`;
    if (actualType && actualType !== declaredType) throw new BlockCompileError([`${label}: il binding fornisce ${actualType}, ma è dichiarato ${declaredType}.`]);
  };
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareText);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of [...(next.get(id) ?? [])].sort(compareText)) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) { queue.push(target); queue.sort(compareText); }
    }
  }
  if (order.length !== nodes.length) throw new BlockCompileError(["Il grafo contiene un ciclo: deve essere un DAG."]);

  const blocks = order.map((nodeId): CompiledBlock => {
    const node = byId.get(nodeId)!;
    const definition = getBlockDefinition(node.data.toolId, node.data.toolVersion);
    if (!definition) throw new BlockCompileError([`${node.data.label}: definizione ${node.data.toolId}@${node.data.toolVersion} non disponibile.`]);
    const combined = { ...definition.defaults, ...node.data.parameters };
    if (definition.type === "pdf.delete-pages" && combined.deleteCurrentPage === true && !pageLoopScopes.has(nodeId)) throw new BlockCompileError([`${node.data.label}: deleteCurrentPage può essere usato solo nel body di loop.eachPage.`]);
    if (definition.type === "pdf.page.delete") {
      const selectors = ["page", "pages", "pageId"].filter((key) => Object.hasOwn(combined, key));
      if (selectors.length !== 1) throw new BlockCompileError([`${node.data.label}: specificare esattamente uno tra page, pages e pageId.`]);
    }
    if (definition.type === "logic.if") {
      const logicIssues = validateLogicIfConfiguration(combined);
      if (logicIssues.length) throw new BlockCompileError(logicIssues.map((issue) => `${node.data.label}: ${issue}`));
      for (const side of ["left", "right"] as const) validateDeclaredOperand(combined, nodeId, `${node.data.label}: ${side}`, side);
    }
    if (["logic.conditionGroup", "loop.while", "loop.repeatUntil"].includes(definition.type)) {
      const conditionIssues = validateConditionGroupAst(combined.condition);
      if (conditionIssues.length) throw new BlockCompileError(conditionIssues.map((issue) => `${node.data.label}: ${issue}`));
      const inspect = (condition: ConditionAst, path: string) => {
        if (condition.kind === "comparison") {
          const comparison = condition as unknown as Record<string, unknown>;
          validateDeclaredOperand(comparison, nodeId, `${node.data.label}: ${path}.left`, "left");
          validateDeclaredOperand(comparison, nodeId, `${node.data.label}: ${path}.right`, "right");
        } else if (condition.kind === "not") inspect(condition.condition, `${path}.condition`);
        else condition.conditions.forEach((child, index) => inspect(child, `${path}.conditions[${index}]`));
      };
      inspect(combined.condition as ConditionAst, "condition");
    }
    if (definition.type === "loop.forEach") {
      const isConnectedVersion = definition.version === "1.2.0";
      const isDocumentLoop = definition.version !== "1.0.0" && combined.itemType === "document";
      const loopIssues = validateForEachConfiguration(combined, definition.version !== "1.0.0", isConnectedVersion);
      if (loopIssues.length) throw new BlockCompileError(loopIssues.map((issue) => `${node.data.label}: ${issue}`));
      const source = combined.source;
      const pdfInputs = edges.filter((edge) => edge.target === nodeId && edge.targetHandle === "pdfs");
      if (isConnectedVersion && isDocumentLoop) {
        if (pdfInputs.length !== 1) throw new BlockCompileError([`${node.data.label}: itemType document richiede una PDF LIST collegata alla porta pdfs.`]);
        const pdfSource = byId.get(pdfInputs[0].source);
        const pdfDefinition = pdfSource && getBlockDefinition(pdfSource.data.toolId, pdfSource.data.toolVersion);
        if (pdfDefinition?.outputs.find((port) => port.id === pdfInputs[0].sourceHandle)?.type !== "documentList") throw new BlockCompileError([`${node.data.label}: la porta pdfs accetta un output documentList, come Input multiplo PDF.`]);
      } else if (isConnectedVersion && pdfInputs.length) {
        throw new BlockCompileError([`${node.data.label}: collega pdfs solo quando itemType è document.`]);
      }
      if (isConnectedVersion && combined.itemType === "document" && source !== undefined) throw new BlockCompileError([`${node.data.label}: per itemType document usa la porta pdfs, senza source.`]);
      if (isParameterBinding(source)) {
        let sourceType: string | undefined;
        if (source.source === "api") sourceType = options.apiParameterTypes?.[source.name];
        else if (source.source === "variable") sourceType = options.variableTypes?.[source.name];
        else if (source.source === "node") {
          const sourceNode = byId.get(source.nodeId); const sourceDefinition = sourceNode && getBlockDefinition(sourceNode.data.toolId, sourceNode.data.toolVersion);
          sourceType = sourceDefinition?.outputs.find((port) => port.id === source.port)?.type;
        } else if (source.source === "constant") sourceType = Array.isArray(source.value) || source.value && typeof source.value === "object" && Array.isArray((source.value as { rows?: unknown }).rows) ? "array" : undefined;
        if (sourceType && !["array", "documentList", "pdf-list", "json"].includes(sourceType)) throw new BlockCompileError([`${node.data.label}: source deve risolvere a un array o a una tabella JSON, ricevuto ${sourceType}.`]);
        if (isDocumentLoop && !isConnectedVersion) {
          const sourceNode = source.source === "node" ? byId.get(source.nodeId) : undefined;
          const sourceDefinition = sourceNode && getBlockDefinition(sourceNode.data.toolId, sourceNode.data.toolVersion);
          if (source.source !== "node" || sourceDefinition?.outputs.find((port) => port.id === source.port)?.type !== "documentList") {
            throw new BlockCompileError([`${node.data.label}: itemType document richiede un output documentList di un nodo precedente, come input.pdf-list.`]);
          }
          for (const edge of edges.filter((candidate) => candidate.source === nodeId && candidate.sourceHandle === "document")) {
            if (!loopRegionsRaw.find((region) => region.nodeId === nodeId)?.bodyNodeIds.has(edge.target)) {
              throw new BlockCompileError([`${node.data.label}: la porta document è disponibile solo nel ramo body del ciclo.`]);
            }
          }
        } else if (!isConnectedVersion && (sourceType === "documentList" || edges.some((edge) => edge.source === nodeId && edge.sourceHandle === "document"))) {
          throw new BlockCompileError([`${node.data.label}: una documentList richiede itemType document e la porta document v1.1.0.`]);
        }
      }
    }
    if (definition.type === "flow.jumpPage") {
      const jumpIssues = validateJumpPageParameters(combined);
      if (jumpIssues.length) throw new BlockCompileError(jumpIssues.map((issue) => `${node.data.label}: ${issue}`));
    }
    if (definition.type === "data.lookup") {
      const result = lookupParametersSchema.safeParse(combined);
      if (!result.success) throw new BlockCompileError(result.error.issues.map((issue) => `${node.data.label}: ${issue.path.join(".")}: ${issue.message}`));
      const lookupSources = edges.filter((edge) => edge.target === nodeId && ["items", "record"].includes(edge.targetHandle ?? ""));
      if (lookupSources.length !== 1) throw new BlockCompileError([`${node.data.label}: collega esattamente una sorgente items (array) o record (oggetto).`]);
    }
    if (definition.type === "data.setVariable") {
      const result = setVariableParametersSchema.safeParse(combined);
      if (!result.success) throw new BlockCompileError(result.error.issues.map((issue) => `${node.data.label}: ${issue.path.join(".")}: ${issue.message}`));
      if (result.data.scope === "loop" && !loopScopes.has(nodeId)) throw new BlockCompileError([`${node.data.label}: una variabile loop può essere impostata solo nel body di un ciclo.`]);
    }
    const missing = definition.requiredParameters.filter((key) => !Object.hasOwn(combined, key));
    if (missing.length) throw new BlockCompileError(missing.map((key) => `${node.data.label}: ${key}: campo obbligatorio.`));
    for (const [key, value] of Object.entries(combined)) {
      if (definition.type === "loop.forEach" && key === "filter") continue;
      validateBinding(value, nodeId, `${node.data.label}.${key}`);
    }
    const shape = (definition.parametersSchema as unknown as { shape?: Record<string, { safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } } }> }).shape;
    if (!shape) throw new BlockCompileError([`${node.data.label}: schema parametri non supportato.`]);
    const parameterJsonSchema = z.toJSONSchema(definition.parametersSchema, { target: "draft-7" }) as { properties?: Record<string, { type?: string }> };
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const value = combined[key];
      if (!isParameterBinding(value)) {
        const result = fieldSchema.safeParse(value);
        if (!result.success) throw new BlockCompileError([`${node.data.label}: ${key}: ${result.error?.issues[0]?.message ?? "valore non valido"}`]);
      } else if (value.source === "loop") {
        const bindingType = value.name === "item" && value.path?.length ? loopScopeValues.get(nodeId)?.get(`item.${value.path[0]}`) : loopScopeValues.get(nodeId)?.get(value.name);
        const fieldType = parameterJsonSchema.properties?.[key]?.type;
        if (bindingType && fieldType && bindingType !== fieldType) throw new BlockCompileError([`${node.data.label}.${key}: il binding loop fornisce ${bindingType}, ma il parametro richiede ${fieldType}.`]);
      }
    }
    for (const key of Object.keys(combined)) if (!Object.hasOwn(shape, key)) throw new BlockCompileError([`${node.data.label}: parametro '${key}' non riconosciuto.`]);
    return {
      nodeId, type: definition.type, version: definition.version,
      handlerId: definition.worker.handlerId, worker: definition.worker.worker,
      timeoutSeconds: definition.worker.timeoutSeconds, resourceClass: definition.worker.resourceClass,
      inputs: definition.inputs.map(({ id, type, required, multiple }) => ({ id, type, required, multiple })),
      outputs: definition.outputs.map(({ id, type, multiple }) => ({ id, type, multiple })),
      parameters: combined,
    };
  });
  const nearestLoop = (nodeId: string) => {
    const candidates = loopRegionsRaw.filter((region) => region.bodyNodeIds.has(nodeId));
    return candidates.find((candidate) => !candidates.some((other) => other.nodeId !== candidate.nodeId && candidate.bodyNodeIds.has(other.nodeId)));
  };
  const transfers: CompiledControlTransfer[] = [];
  for (const block of blocks) {
    if (!["flow.break", "flow.continue", "flow.jumpPage"].includes(block.type)) continue;
    const loop = nearestLoop(block.nodeId);
    if (!loop) throw new BlockCompileError([`${byId.get(block.nodeId)?.data.label}: questo blocco è disponibile solo nel body di un ciclo.`]);
    if (block.type === "flow.jumpPage" && loop.type !== "loop.eachPage") throw new BlockCompileError([`${byId.get(block.nodeId)?.data.label}: il salto pagina è consentito solo nel body di loop.eachPage.`]);
    const kind = block.type === "flow.break" ? "break" : block.type === "flow.continue" ? "continue" : "jumpPage";
    transfers.push({ nodeId: block.nodeId, kind, loopNodeId: loop.nodeId });
  }
  const loopRegions: CompiledLoopRegion[] = loopRegionsRaw.map((region) => {
    const parentCandidates = loopRegionsRaw.filter((candidate) => candidate.nodeId !== region.nodeId && candidate.bodyNodeIds.has(region.nodeId));
    const parent = parentCandidates.find((candidate) => !parentCandidates.some((other) => other.nodeId !== candidate.nodeId && candidate.bodyNodeIds.has(other.nodeId)));
    return { nodeId: region.nodeId, type: region.type, bodyNodeIds: [...region.bodyNodeIds].sort(compareText), afterNodeIds: [...region.afterNodeIds].sort(compareText), ...(parent ? { parentLoopId: parent.nodeId } : {}) };
  }).sort((a, b) => compareText(a.nodeId, b.nodeId));
  transfers.sort((a, b) => compareText(a.nodeId, b.nodeId));
  const handlerMap = new Map<string, CompiledPlan["manifest"]["handlers"][number]>();
  for (const block of blocks) {
    const key = `${block.type}@${block.version}`;
    handlerMap.set(key, { type: block.type, version: block.version, handlerId: block.handlerId, worker: block.worker, timeoutSeconds: block.timeoutSeconds, resourceClass: block.resourceClass });
  }
  const apiParameters = normalizeManifest(options.apiParameterManifest ?? (options.apiParameters ?? []).map((name) => ({ name, type: options.apiParameterTypes?.[name] ?? "unknown", required: false })));
  const variables = normalizeManifest(options.variableManifest ?? (options.variables ?? []).map((name) => ({ name, type: options.variableTypes?.[name] ?? "unknown", required: false })));
  const canonicalGraph = { nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data })), edges };
  const graphHash = sha256(stableStringify(canonicalGraph));
  const planWithoutHash = {
    formatVersion: 2 as const,
    compilerVersion: "2.0.0" as const,
    graphHash,
    order,
    blocks,
    edges: edges.map((edge) => ({ ...edge })),
    controlFlow: { loops: loopRegions, transfers },
    manifest: { apiParameters, variables, handlers: [...handlerMap.values()].sort((a, b) => compareText(`${a.type}@${a.version}`, `${b.type}@${b.version}`)) },
  };
  if (diagnostics.length) throw new BlockCompileError(diagnostics.map((item) => item.message), diagnostics);
  return { ...planWithoutHash, planHash: sha256(stableStringify(planWithoutHash)) };
}

function normalizeManifest(parameters: PlanParameter[]): PlanParameter[] {
  return parameters.map((parameter) => ({ ...parameter })).sort((a, b) => compareText(a.name, b.name));
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function compareText(a: string, b: string): number {
  const left = Array.from(a, (character) => character.codePointAt(0)!);
  const right = Array.from(b, (character) => character.codePointAt(0)!);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
}
function compareEdges(a: BatchEdge, b: BatchEdge): number {
  return compareText(`${a.source}\u0000${a.sourceHandle ?? ""}\u0000${a.target}\u0000${a.targetHandle ?? ""}\u0000${a.id}`, `${b.source}\u0000${b.sourceHandle ?? ""}\u0000${b.target}\u0000${b.targetHandle ?? ""}\u0000${b.id}`);
}

function validateExpressionPaths(value: unknown, nodeId: string, label: string, options: { apiParameters?: string[]; variables?: string[] }, byId: Map<string, BatchNode>, ancestors: Map<string, Set<string>>, loopScopes: Set<string>, loopScopeValues: Map<string, Map<string, string>>) {
  if (Array.isArray(value)) { value.forEach((item) => validateExpressionPaths(item, nodeId, label, options, byId, ancestors, loopScopes, loopScopeValues)); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.op === "path") {
    const path = record.path;
    if (!Array.isArray(path) || path.some((part) => typeof part !== "string")) throw new BlockCompileError([`${label}: percorso espressione non valido.`]);
    const root = record.root as string; const first = path[0] as string;
    if (root === "api" && options.apiParameters && !options.apiParameters.includes(first)) throw new BlockCompileError([`${label}: parametro API '${first}' non definito.`]);
    if (root === "variables" && options.variables && !options.variables.includes(first)) throw new BlockCompileError([`${label}: variabile '${first}' non definita.`]);
    if (root === "loop") {
      const scope = loopScopeValues.get(nodeId);
      if (!scope?.has(first)) throw new BlockCompileError([`${label}: variabile loop '${first}' fuori scope o non definita.`]);
      if (first === "item" && path.length > 1 && !scope.has(`item.${path[1]}`)) throw new BlockCompileError([`${label}: colonna item '${path[1]}' non dichiarata.`]);
      if (first !== "item" && path.length > 1) throw new BlockCompileError([`${label}: percorso loop non valido.`]);
    }
    if (root === "nodes") {
      const source = byId.get(first); const port = path[1]; const definition = source && getBlockDefinition(source.data.toolId, source.data.toolVersion);
      if (!ancestors.get(nodeId)?.has(first) || typeof port !== "string" || !definition?.outputs.some((item) => item.id === port && item.type !== "control")) throw new BlockCompileError([`${label}: percorso output nodo fuori scope o non valido.`]);
    }
    return;
  }
  Object.values(record).forEach((item) => validateExpressionPaths(item, nodeId, label, options, byId, ancestors, loopScopes, loopScopeValues));
}
