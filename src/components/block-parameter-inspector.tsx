"use client";

import { useMemo, useState } from "react";
import { isParameterBinding, resolveParameterBindings, type BindingContext } from "@/lib/blocks/bindings";
import { getPreviousNodes, getParameterIssues, isApiParameterCompatible, isCompatibleParameterType } from "@/lib/blocks/inspector";
import type { ApiParameter, BatchEdge, BatchNode, BatchVariable } from "@/lib/batch-graph";
import { getBlockDefinition, type BlockDefinition } from "@/lib/blocks/registry";
import { ConditionGroupBuilder } from "@/components/condition-group-builder";
import { conditionAstSchema, defaultConditionAst } from "@/lib/blocks/condition-group";
import { z } from "zod";

type Mode = "static" | "constant" | "api" | "node" | "variable" | "loop" | "expression";
const inputClass = "mt-1.5 w-full rounded-md border border-[#293844] bg-[#111b25] px-2.5 py-2 text-[10px] text-slate-200 outline-none focus:border-[#5384ce]";
const loopScopeTypes: Array<[string, "number" | "string"]> = [["currentPage", "number"], ["pageCount", "number"], ["index", "number"], ["pageId", "string"]];

export function BlockParameterInspector({ definition, values, apiParameters, nodes, edges, currentNodeId, variables, onChange }: {
  definition: BlockDefinition;
  values: Record<string, unknown>;
  apiParameters: ApiParameter[];
  nodes: BatchNode[];
  edges: BatchEdge[];
  currentNodeId: string;
  variables: BatchVariable[];
  onChange: (key: string, value: unknown) => void;
}) {
  const [previewInputs, setPreviewInputs] = useState<Record<string, unknown>>(() => Object.fromEntries(apiParameters.map((item) => [item.name, item.defaultValue]).filter(([, value]) => value !== undefined)));
  const [previewNodes, setPreviewNodes] = useState<Record<string, Record<string, unknown>>>({});
  const [previewVariables, setPreviewVariables] = useState<Record<string, unknown>>(() => Object.fromEntries(variables.map((item) => [item.name, item.defaultValue]).filter(([, value]) => value !== undefined)));
  const schema = useMemo(() => JSON.parse(JSON.stringify(z.toJSONSchema(definition.parametersSchema, { target: "draft-7" }))) as Record<string, unknown>, [definition]);
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: (string | number)[]; default?: unknown; minimum?: number; maximum?: number; items?: { type?: string } }>;
  const errors = getParameterIssues(definition, values);
  if (definition.type === "pdf.delete-pages" && values.deleteCurrentPage === true && !isInLoopBody(currentNodeId, nodes, edges)) errors.deleteCurrentPage = "Disponibile solo nel ramo body di Per ogni pagina.";
  if (definition.type === "data.setVariable" && values.scope === "loop" && !isInLoopBody(currentNodeId, nodes, edges)) errors.scope = "Una variabile loop si può impostare solo nel body di un ciclo.";
  const previousNodes = getPreviousNodes(currentNodeId, nodes, edges);
  const conditionNodes = ["loop.while", "loop.repeatUntil"].includes(definition.type)
    ? [...new Map([...previousNodes, ...nodes.filter((node) => loopBranchIds(currentNodeId, "body", edges).has(node.id) && !loopBranchIds(currentNodeId, "after", edges).has(node.id))].map((node) => [node.id, node])).values()]
    : previousNodes;
  const loopValues = getLoopValues(currentNodeId, nodes, edges, apiParameters);
  const loopOptions = getLoopOptionTypes(currentNodeId, nodes, edges, apiParameters);
  const context: BindingContext = { api: previewInputs, nodes: previewNodes, variables: previewVariables, loop: loopValues };

  return <div className="mt-3 space-y-4">
    {Object.entries(properties).length ? Object.entries(properties).map(([name, property]) => {
      const raw = values[name] ?? (definition.type === "logic.if" ? property.default : undefined);
      if (definition.type === "pdf.delete-pages" && name === "deleteCurrentPage") return <section key={name} className={`rounded-lg border ${errors[name] ? "border-red-900/70" : "border-[#263541]"} bg-[#101923] p-3`}>
        <label className="flex items-center gap-2 text-[10px] font-medium text-slate-200"><input type="checkbox" checked={Boolean(raw ?? property.default)} onChange={(event) => onChange(name, event.target.checked)} className="accent-[#457ccf]"/>Elimina la pagina corrente nel loop</label>
        <p className="mt-1 text-[9px] leading-4 text-slate-500">L&apos;eliminazione viene accodata per l&apos;indice originario e applicata dopo tutte le iterazioni; attivala solo su un percorso body condizionale.</p>
        {errors[name] && <p role="alert" className="mt-1 text-[9px] text-red-300">{errors[name]}</p>}
      </section>;
      if (["logic.conditionGroup", "loop.while", "loop.repeatUntil"].includes(definition.type) && name === "condition") {
        const parsedAst = conditionAstSchema.safeParse(raw ?? defaultConditionAst);
        return <section key={name} className={`rounded-lg border ${errors[name] ? "border-red-900/70" : "border-[#263541]"} bg-[#101923] p-3`}>
          <div className="mb-2 flex items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-200">condition</span><span className="ml-auto rounded bg-[#152337] px-1.5 py-0.5 text-[8px] text-[#7aa1db]">Richiesto</span></div>
          <p className="mb-2 text-[9px] leading-4 text-slate-500">{definition.type === "loop.while" ? "La condizione viene controllata prima di body: il ciclo continua finché è vera." : definition.type === "loop.repeatUntil" ? "body viene eseguito almeno una volta; il ciclo termina quando questa condizione diventa vera." : "Definisci confronti su parametri API o output di nodi precedenti e raggruppali con AND, OR e NOT."}</p>
          <ConditionGroupBuilder value={parsedAst.success ? parsedAst.data : defaultConditionAst} apiParameters={apiParameters} nodes={nodes} previousNodes={conditionNodes} currentNodeId={currentNodeId} variables={variables} loopOptions={loopOptions} onChange={(condition) => onChange(name, condition)} error={errors[name]}/>
        </section>;
      }
      const mode = readMode(raw);
      const binding = isParameterBinding(raw) ? raw : null;
      const sideType = name === "left" ? values.leftType : name === "right" ? values.rightType : undefined;
      const expected = definition.type === "loop.forEach" && name === "source" ? "array" : definition.type === "logic.if" && (name === "left" || name === "right")
        ? (sideType === "array" ? "array" : sideType === "object" ? "object" : sideType as string | undefined)
        : property.type;
      const editorProperty = definition.type === "logic.if" && (name === "left" || name === "right")
        ? { ...property, type: "object" }
        : property;
      const apiOptions = apiParameters.filter((item) => !(name === "parameter" && definition.category === "input") && isApiParameterCompatible(definition.type, name, expected, item.type));
      const variableOptions = variables.filter((item) => isCompatibleParameterType(expected, item.type));
      const loopVariableOptions = getPreviousNodes(currentNodeId, nodes, edges).flatMap((item) => {
        const source = nodes.find((candidate) => candidate.id === item.id);
        const params = source?.data.parameters;
        return source?.data.toolId === "data.setVariable" && params?.scope === "loop" && typeof params.name === "string" && isCompatibleParameterType(expected, params.valueType as Parameters<typeof isCompatibleParameterType>[1])
          ? [{ name: params.name, type: String(params.valueType) }] : [];
      });
      const nodeOptions = previousNodes.flatMap((node) => {
        const source = nodes.find((item) => item.id === node.id);
        const sourceDefinition = source && getBlockDefinition(source.data.toolId, source.data.toolVersion);
        return (sourceDefinition?.outputs ?? []).filter((port) => port.type !== "control" && isCompatibleParameterType(expected, port.type)).map((port) => ({ node, port }));
      });
      const preview = getPreview(raw, context);
      return <div key={name} className={`rounded-lg border ${errors[name] ? "border-red-900/70" : "border-[#263541]"} bg-[#101923] p-3`}>
        <div className="flex items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-200">{name}</span><span className={`text-[8px] uppercase ${errors[name] ? "text-red-300" : "text-slate-600"}`}>{property.type ?? "json"}</span>{definition.requiredParameters.includes(name) && <span className="ml-auto rounded bg-[#152337] px-1.5 py-0.5 text-[8px] text-[#7aa1db]">Richiesto</span>}</div>
        {property.description && <p className="mt-1 text-[9px] leading-4 text-slate-500">{property.description}</p>}
        {!definition.requiredParameters.includes(name) && <p className="mt-1 text-[8px] text-slate-600">Facoltativo{property.default === undefined ? " · nessun default" : ` · default: ${shortValue(property.default)}`}</p>}
        <label className="mt-2 block text-[9px] text-slate-500">Origine valore<select aria-label={`Origine del parametro ${name}`} value={mode} onChange={(event) => onChange(name, changeMode(event.target.value as Mode, raw, property.default))} className={inputClass}>
          <option value="static">Valore diretto</option><option value="constant">Costante</option>
          {apiOptions.length > 0 && <option value="api">Parametro API</option>}{nodeOptions.length > 0 && <option value="node">Output nodo precedente</option>}{(variableOptions.length > 0 || loopVariableOptions.length > 0) && <option value="variable">Variabile contesto</option>}
          {Object.keys(loopValues).length > 0 && <option value="loop">Variabile loop</option>}{<option value="expression">Espressione dichiarativa</option>}
        </select></label>
        {mode === "static" || mode === "constant" ? <ValueEditor key={`${name}:${mode}:${JSON.stringify(mode === "constant" ? binding && binding.source === "constant" ? binding.value : property.default : raw)}`} property={editorProperty} value={mode === "constant" ? binding && binding.source === "constant" ? binding.value : property.default : raw} onChange={(value) => onChange(name, mode === "constant" ? { source: "constant", value } : value)}/> : null}
        {mode === "api" && <select className={inputClass} value={binding?.source === "api" ? binding.name : legacyApiName(raw)} onChange={(event) => {
          const parameterName = event.target.value;
          onChange(name, parameterName ? { source: "api", name: parameterName } : undefined);
          if (definition.type === "loop.forEach" && name === "source") {
            const selectedParameter = apiParameters.find((item) => item.name === parameterName);
            const columns = selectedParameter?.arrayColumns?.map(({ name: columnName, type: columnType }) => ({ name: columnName, type: columnType })) ?? [];
            onChange("itemType", selectedParameter?.itemType ?? (columns.length ? "object" : "string"));
            onChange("columns", columns);
          }
        }}><option value="">Seleziona parametro API</option>{apiOptions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.type}{item.defaultValue === undefined ? "" : ` · default ${shortValue(item.defaultValue)}`}</option>)}</select>}
        {mode === "node" && <select className={inputClass} value={binding?.source === "node" ? `${binding.nodeId}:${binding.port}` : ""} onChange={(event) => { const [nodeId, port] = event.target.value.split(":"); onChange(name, nodeId && port ? { source: "node", nodeId, port } : undefined); }}><option value="">Seleziona output precedente</option>{nodeOptions.map(({ node, port }) => <option key={`${node.id}:${port.id}`} value={`${node.id}:${port.id}`}>{node.data.label} · {port.label} ({port.type})</option>)}</select>}
        {mode === "variable" && <select className={inputClass} value={binding?.source === "variable" ? `${binding.scope === "loop" ? "loop" : "workflow"}:${binding.name}` : ""} onChange={(event) => { const [scope, variableName] = event.target.value.split(":"); onChange(name, variableName ? { source: "variable", scope: scope as "workflow" | "loop", name: variableName } : undefined); }}><option value="">Seleziona variabile</option>{variableOptions.map((item) => <option key={`workflow:${item.name}`} value={`workflow:${item.name}`}>{item.name} · workflow ({item.type})</option>)}{loopVariableOptions.map((item) => <option key={`loop:${item.name}`} value={`loop:${item.name}`}>{item.name} · loop ({item.type})</option>)}</select>}
        {mode === "loop" && <select className={inputClass} value={binding?.source === "loop" ? binding.name === "item" && binding.path?.length ? `item.${binding.path.join(".")}` : binding.name : ""} onChange={(event) => { const selected = event.target.value; const itemPath = selected.startsWith("item.") ? selected.slice(5).split(".") : []; onChange(name, selected ? { source: "loop", name: itemPath.length ? "item" : selected, ...(itemPath.length ? { path: itemPath } : {}) } : undefined); }}><option value="">Seleziona variabile loop</option>{loopOptions.filter(([, type]) => isCompatibleParameterType(expected, type as Parameters<typeof isCompatibleParameterType>[1])).map(([item]) => <option key={item} value={item}>{item}</option>)}</select>}
        {mode === "expression" && <ExpressionBuilder value={binding?.source === "expression" ? binding.expression : undefined} expectedType={expected} apiParameters={apiParameters} nodes={previousNodes} variables={variables} loopOptions={loopOptions} onChange={(expression) => onChange(name, { source: "expression", expression })}/>}
        {errors[name] && <p role="alert" className="mt-1.5 text-[9px] text-red-300">{errors[name]}</p>}
        {raw !== undefined && <div className="mt-2 rounded border border-[#24333d] bg-[#0a1219] p-2"><p className="text-[8px] uppercase tracking-wide text-slate-600">Anteprima test</p><p className="mt-1 break-all font-mono text-[9px] text-[#84a2cf]">{preview}</p>{binding?.source === "api" && <label className="mt-2 block text-[8px] text-slate-600">Valore temporaneo per anteprima<input value={String(previewInputs[binding.name] ?? "")} onChange={(event) => setPreviewInputs((current) => ({ ...current, [binding.name]: convertPreview(event.target.value, apiParameters.find((item) => item.name === binding.name)?.type) }))} className={inputClass}/></label>}{binding?.source === "variable" && <label className="mt-2 block text-[8px] text-slate-600">Valore temporaneo per anteprima<input value={String(previewVariables[binding.name] ?? "")} onChange={(event) => setPreviewVariables((current) => ({ ...current, [binding.name]: convertNodePreview(event.target.value, variables.find((item) => item.name === binding.name)?.type) }))} className={inputClass}/></label>}</div>}
        {binding?.source === "node" && <label className="mt-2 block text-[8px] text-slate-600">Output test temporaneo per anteprima<input value={String(previewNodes[binding.nodeId]?.[binding.port] ?? "")} onChange={(event) => setPreviewNodes((current) => ({ ...current, [binding.nodeId]: { ...current[binding.nodeId], [binding.port]: convertNodePreview(event.target.value, expected) } }))} className={inputClass}/></label>}
      </div>;
    }) : <p className="text-[10px] text-slate-600">Questo blocco non richiede parametri.</p>}
  </div>;
}

function readMode(value: unknown): Mode {
  if (!value || typeof value !== "object") return "static";
  if ("source" in value && typeof value.source === "string" && ["constant", "api", "node", "variable", "loop", "expression"].includes(value.source)) return value.source as Mode;
  if ("$param" in value) return "api";
  return "static";
}

function loopBranchIds(loopId: string, handle: string, edges: BatchEdge[]) {
  const seen = new Set<string>(); const pending = edges.filter((edge) => edge.source === loopId && edge.sourceHandle === handle).map((edge) => edge.target);
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); for (const edge of edges) if (edge.source === id) pending.push(edge.target); }
  return seen;
}

function getLoopOptionTypes(nodeId: string, nodes: BatchNode[], edges: BatchEdge[], apiParameters: ApiParameter[]): Array<[string, string]> {
  const options = new Map<string, string>();
  for (const loop of nodes.filter((node) => ["loop.eachPage", "loop.forEach", "loop.while", "loop.repeatUntil"].includes(node.data.toolId))) {
    const body = loopBranchIds(loop.id, "body", edges); const after = loopBranchIds(loop.id, "after", edges);
    if (!body.has(nodeId) || after.has(nodeId)) continue;
    if (loop.data.toolId === "loop.eachPage") {
      for (const [name, type] of loopScopeTypes) options.set(name, type);
    } else if (loop.data.toolId === "loop.forEach") {
      const itemType = String(loop.data.parameters.itemType ?? "object"); options.set("item", itemType);
      options.set("index", "number");
      const configuredColumns = Array.isArray(loop.data.parameters.columns) ? loop.data.parameters.columns : [];
      const source = loop.data.parameters.source;
      const apiName = source && typeof source === "object" && "source" in source && source.source === "api" && "name" in source && typeof source.name === "string"
        ? source.name
        : source && typeof source === "object" && "$param" in source && typeof source.$param === "string" ? source.$param : null;
      const apiColumns = apiParameters.find((parameter) => parameter.name === apiName)?.arrayColumns ?? [];
      const columns = configuredColumns.length ? configuredColumns : apiColumns;
      if (itemType === "object") for (const column of columns) {
        if (column && typeof column === "object" && typeof column.name === "string" && typeof column.type === "string") options.set(`item.${column.name}`, column.type);
      }
    } else options.set("iteration", "number");
  }
  return [...options.entries()];
}

function getLoopValues(nodeId: string, nodes: BatchNode[], edges: BatchEdge[], apiParameters: ApiParameter[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, type] of getLoopOptionTypes(nodeId, nodes, edges, apiParameters)) {
    if (name.startsWith("item.")) continue;
    if (name === "item") values.item = type === "object" ? {} : type === "array" ? [] : type === "number" ? 1 : type === "boolean" ? true : "valore";
    else values[name] = name === "pageId" ? "page-id" : type === "number" ? 1 : "valore";
  }
  return values;
}

function isInLoopBody(nodeId: string, nodes: BatchNode[], edges: BatchEdge[]) {
  for (const loop of nodes.filter((node) => node.data.toolId === "loop.eachPage" || node.data.toolId === "loop.forEach")) {
    if (loopBranchIds(loop.id, "body", edges).has(nodeId) && !loopBranchIds(loop.id, "after", edges).has(nodeId)) return true;
  }
  return false;
}

function changeMode(mode: Mode, current: unknown, fallback: unknown): unknown {
  if (mode === "static") return isParameterBinding(current) ? fallback : current ?? fallback;
  if (mode === "constant") return { source: "constant", value: fallback ?? "" };
  if (mode === "api") return { source: "api", name: "" };
  if (mode === "node") return { source: "node", nodeId: "", port: "" };
  if (mode === "variable") return { source: "variable", name: "" };
  if (mode === "loop") return { source: "loop", name: "" };
  return { source: "expression", expression: { op: "literal", value: fallback ?? null } };
}

function ValueEditor({ property, value, onChange }: { property: { type?: string; enum?: (string | number)[]; minimum?: number; maximum?: number; items?: { type?: string } }; value: unknown; onChange: (value: unknown) => void }) {
  if (property.enum) return <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={inputClass}><option value="">Seleziona…</option>{property.enum.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
  if (property.type === "boolean") return <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-400"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="accent-[#457ccf]"/>Vero</label>;
  if (property.type === "number" || property.type === "integer") return <input type="number" min={property.minimum} max={property.maximum} value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} className={inputClass}/>;
  if (property.type === "object" || property.type === "array") return <JsonValueEditor value={value} onChange={onChange}/>;
  return <input type="text" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value)} className={inputClass}/>;
}

function JsonValueEditor({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  return <><textarea value={text} rows={5} onChange={(event) => { setText(event.target.value); try { onChange(JSON.parse(event.target.value) as unknown); setError(""); } catch { setError("JSON non valido: completa una struttura JSON prima di salvare."); } }} className={`${inputClass} font-mono`} placeholder="Inserisci JSON valido"/>{error && <p role="alert" className="mt-1 text-[9px] text-red-300">{error}</p>}</>;
}

function ExpressionBuilder({ value, expectedType, apiParameters, nodes, variables, loopOptions, onChange }: { value: unknown; expectedType?: string; apiParameters: ApiParameter[]; nodes: BatchNode[]; variables: BatchVariable[]; loopOptions: Array<[string, string]>; onChange: (value: unknown) => void }) {
  const current = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pathExpr = current.op === "path" ? current : current.left && typeof current.left === "object" ? current.left as Record<string, unknown> : {};
  const root = (pathExpr.root as string) || "api";
  const path = Array.isArray(pathExpr.path) ? pathExpr.path.map(String) : [];
  const sources = sourcesFor(root, apiParameters, nodes, variables, expectedType, loopOptions);
  const op = typeof current.op === "string" ? current.op : "path";
  const pathNode = (selectedRoot: string, selectedPath: string) => ({ op: "path", root: selectedRoot, path: selectedRoot === "nodes" || selectedRoot === "loop" ? selectedPath.split(".") : [selectedPath] });
  const changeRoot = (selectedRoot: string) => { const first = sourcesFor(selectedRoot, apiParameters, nodes, variables, expectedType, loopOptions)[0] ?? ""; onChange(pathNode(selectedRoot, first)); };
  const changeOperator = (next: string) => { const left = pathNode(root, path[0] ?? ""); onChange(next === "path" ? left : { op: next, left, right: { op: "literal", value: expectedType === "number" || expectedType === "integer" ? 0 : "" } }); };
  return <div className="mt-2 rounded border border-[#2b3b46] bg-[#0c151d] p-2"><p className="text-[9px] font-medium text-slate-400">Expression builder</p><div className="mt-2 grid grid-cols-2 gap-2"><select value={root} onChange={(event) => changeRoot(event.target.value)} className={inputClass}><option value="api">Parametro API</option><option value="nodes">Output nodo precedente</option><option value="variables">Variabile contesto</option><option value="loop" disabled={!loopOptions.length}>Variabile loop</option></select><select value={op} onChange={(event) => changeOperator(event.target.value)} className={inputClass}><option value="path">Valore</option><option value="eq">Uguale a</option><option value="neq">Diverso da</option>{(expectedType === "number" || expectedType === "integer") && <><option value="gt">Maggiore di</option><option value="gte">Maggiore o uguale</option><option value="lt">Minore di</option><option value="lte">Minore o uguale</option></>}{(expectedType === "string" || expectedType === "array") && <option value="contains">Contiene</option>}</select></div><select value={root === "nodes" || root === "loop" ? path.join(".") : path[0] ?? ""} onChange={(event) => { const selected = event.target.value; const nextPath = root === "loop" ? selected.split(".") : root === "nodes" ? selected.split(".") : [selected]; const left = { op: "path", root, path: nextPath }; onChange(op === "path" ? left : { ...current, left }); }} className={inputClass}><option value="">Seleziona origine</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select>{op !== "path" && <input aria-label="Valore di confronto" type={expectedType === "number" || expectedType === "integer" ? "number" : "text"} value={literalValue(current.right)} onChange={(event) => onChange({ ...current, right: { op: "literal", value: expectedType === "number" || expectedType === "integer" ? Number(event.target.value) : event.target.value } })} placeholder="Valore di confronto" className={inputClass}/>}</div>;
}

function sourcesFor(root: string, api: ApiParameter[], nodes: BatchNode[], variables: BatchVariable[], expectedType?: string, loopOptions: Array<[string, string]> = []) {
  if (root === "api") return api.filter((item) => isCompatibleParameterType(expectedType, item.type)).map((item) => item.name);
  if (root === "nodes") return nodes.flatMap((node) => (getBlockDefinition(node.data.toolId, node.data.toolVersion)?.outputs ?? []).filter((port) => port.type !== "control" && isCompatibleParameterType(expectedType, port.type)).map((port) => `${node.id}.${port.id}`));
  if (root === "variables") return variables.filter((item) => isCompatibleParameterType(expectedType, item.type)).map((item) => item.name);
  if (root === "loop") return loopOptions.filter(([, type]) => isCompatibleParameterType(expectedType, type as Parameters<typeof isCompatibleParameterType>[1])).map(([name]) => name);
  return [];
}

function literalValue(value: unknown): string { return value && typeof value === "object" && "value" in value ? String((value as { value: unknown }).value ?? "") : ""; }
function legacyApiName(value: unknown): string { return value && typeof value === "object" && "$param" in value && typeof value.$param === "string" ? value.$param : ""; }
function getPreview(value: unknown, context: BindingContext): string {
  if (!isParameterBinding(value)) return value === undefined ? "Non impostato" : shortValue(value);
  try {
    const result = resolveParameterBindings(value, context);
    if (result === undefined || result === "") return "Inserisci un valore test per questa origine.";
    return shortValue(result);
  } catch (error) {
    return error instanceof Error ? error.message : "Anteprima non disponibile.";
  }
}
function shortValue(value: unknown): string { const text = typeof value === "string" ? value : JSON.stringify(value); return (text ?? "undefined").slice(0, 180); }
function convertPreview(value: string, type: ApiParameter["type"] | undefined): unknown {
  if (type === "number") return value === "" ? undefined : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "json") { try { return JSON.parse(value) as unknown; } catch { return value; } }
  return value;
}
function convertNodePreview(value: string, type: string | undefined): unknown {
  if (type === "number") return value === "" ? undefined : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "object" || type === "array") { try { return JSON.parse(value) as unknown; } catch { return value; } }
  return value;
}
