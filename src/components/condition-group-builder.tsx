"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ApiParameter, BatchNode, BatchVariable } from "@/lib/batch-graph";
import { isParameterBinding } from "@/lib/blocks/bindings";
import { getBlockDefinition } from "@/lib/blocks/registry";
import { isCompatibleParameterType } from "@/lib/blocks/inspector";
import type { ConditionAst } from "@/lib/blocks/condition-group";

const inputClass = "mt-1 w-full rounded-md border border-[#293844] bg-[#111b25] px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-[#5384ce]";
const typeChoices = ["string", "number", "boolean", "array", "object"] as const;
const operators = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull"] as const;
const operatorLabels: Record<string, string> = {
  eq: "Uguale a", neq: "Diverso da", gt: "Maggiore di", gte: "Maggiore o uguale", lt: "Minore di", lte: "Minore o uguale",
  contains: "Contiene", notContains: "Non contiene", startsWith: "Inizia con", endsWith: "Termina con", in: "È incluso in", notIn: "Non è incluso in",
  isEmpty: "È vuoto", isNull: "È null",
};
type CompareNode = Extract<ConditionAst, { kind: "comparison" }>;

export function ConditionGroupBuilder({ value, apiParameters, nodes, previousNodes, currentNodeId, variables, loopOptions = [], onChange, error }: {
  value: ConditionAst;
  apiParameters: ApiParameter[];
  nodes: BatchNode[];
  previousNodes: BatchNode[];
  currentNodeId: string;
  variables: BatchVariable[];
  loopOptions?: Array<[string, string]>;
  onChange: (value: ConditionAst) => void;
  error?: string;
}) {
  return <div className="rounded-lg border border-[#2b3b46] bg-[#0c151d] p-3">
    <div className="mb-3 flex items-start justify-between gap-2"><div><p className="text-[10px] font-semibold text-slate-200">Builder condizioni</p><p className="mt-1 text-[9px] leading-4 text-slate-500">Combina condizioni dichiarative; i gruppi vengono valutati in ordine e con short-circuit.</p></div><span className="rounded bg-[#182538] px-1.5 py-1 text-[8px] text-[#82a5d9]">max 8 livelli · 32 confronti</span></div>
    <ConditionNodeEditor value={value} onChange={onChange} apiParameters={apiParameters} nodes={nodes} previousNodes={previousNodes} currentNodeId={currentNodeId} variables={variables} loopOptions={loopOptions}/>
    {error && <p role="alert" className="mt-2 text-[9px] leading-4 text-red-300">{error}</p>}
  </div>;
}

function ConditionNodeEditor({ value, onChange, apiParameters, nodes, previousNodes, currentNodeId, variables, loopOptions, onRemove, depth = 0 }: {
  value: ConditionAst;
  onChange: (value: ConditionAst) => void;
  apiParameters: ApiParameter[];
  nodes: BatchNode[];
  previousNodes: BatchNode[];
  currentNodeId: string;
  variables: BatchVariable[];
  loopOptions: Array<[string, string]>;
  onRemove?: () => void;
  depth?: number;
}) {
  const replaceKind = (kind: string) => {
    if (kind === "comparison") onChange(makeComparison());
    else if (kind === "not") onChange({ kind: "not", condition: makeComparison() });
    else onChange({ kind: "group", operator: "AND", conditions: [makeComparison()] });
  };
  const frame = `rounded-md border ${depth ? "border-[#263744] bg-[#101a23]" : "border-[#34414a] bg-[#111b24]"} p-2.5`;
  if (value.kind === "comparison") return <div className={frame}>
    <div className="flex items-center gap-2"><span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">Confronto</span><select aria-label="Tipo condizione" value="comparison" onChange={(event) => replaceKind(event.target.value)} className={`${inputClass} mt-0 max-w-32`}><option value="comparison">Confronto</option><option value="group">Gruppo AND/OR</option><option value="not">NOT</option></select>{onRemove && <button type="button" onClick={onRemove} aria-label="Rimuovi condizione" className="ml-auto rounded p-1 text-slate-600 hover:bg-red-950/40 hover:text-red-300"><Trash2 size={13}/></button>}</div>
    <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[8px] text-slate-500">Tipo left<select value={value.leftType} onChange={(event) => onChange({ ...value, leftType: event.target.value as CompareNode["leftType"] })} className={inputClass}>{typeChoices.map((type) => <option key={type}>{type}</option>)}</select></label><label className="text-[8px] text-slate-500">Tipo right<select value={value.rightType} onChange={(event) => onChange({ ...value, rightType: event.target.value as CompareNode["rightType"] })} className={inputClass}>{typeChoices.map((type) => <option key={type}>{type}</option>)}</select></label></div>
    <label className="mt-2 block text-[8px] text-slate-500">Operatore<select value={value.operator} onChange={(event) => { const operator = event.target.value as CompareNode["operator"]; onChange({ ...value, operator, ...(["isEmpty", "isNull"].includes(operator) ? { right: undefined } : {}) }); }} className={inputClass}>{operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></label>
    <div className={`mt-2 grid ${["isEmpty", "isNull"].includes(value.operator) ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
      <OperandEditor label="Valore left" value={value.left} type={value.leftType} apiParameters={apiParameters} previousNodes={previousNodes} variables={variables} loopOptions={loopOptions} onChange={(left) => onChange({ ...value, left: left as CompareNode["left"] })}/>
      {!(["isEmpty", "isNull"].includes(value.operator)) && <OperandEditor label="Valore right" value={value.right} type={value.rightType} apiParameters={apiParameters} previousNodes={previousNodes} variables={variables} loopOptions={loopOptions} onChange={(right) => onChange({ ...value, right: right as CompareNode["right"] })}/>}
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[8px] text-slate-500">Maiuscole/minuscole<select value={String(value.caseSensitive)} onChange={(event) => onChange({ ...value, caseSensitive: event.target.value === "true" })} className={inputClass}><option value="false">Ignora</option><option value="true">Distingui</option></select></label><label className="text-[8px] text-slate-500">Gestione null<select value={value.nullBehavior} onChange={(event) => onChange({ ...value, nullBehavior: event.target.value as CompareNode["nullBehavior"] })} className={inputClass}><option value="equalOnly">Solo uguaglianza / isNull</option><option value="treatAsEmpty">Tratta come vuoto</option><option value="reject">Errore</option></select></label></div>
  </div>;

  if (value.kind === "not") return <div className={frame}>
    <div className="mb-2 flex items-center gap-2"><span className="text-[9px] font-semibold text-[#efc77c]">NOT</span><select aria-label="Tipo condizione" value="not" onChange={(event) => replaceKind(event.target.value)} className={`${inputClass} mt-0 max-w-36`}><option value="not">NOT</option><option value="comparison">Confronto</option><option value="group">Gruppo AND/OR</option></select>{onRemove && <button type="button" onClick={onRemove} aria-label="Rimuovi condizione" className="ml-auto rounded p-1 text-slate-600 hover:text-red-300"><Trash2 size={13}/></button>}</div>
    <ConditionNodeEditor value={value.condition} onChange={(condition) => onChange({ ...value, condition })} apiParameters={apiParameters} nodes={nodes} previousNodes={previousNodes} currentNodeId={currentNodeId} variables={variables} loopOptions={loopOptions} depth={depth + 1}/>
  </div>;

  return <div className={frame}>
    <div className="flex flex-wrap items-center gap-2"><select aria-label="Tipo condizione" value="group" onChange={(event) => replaceKind(event.target.value)} className={`${inputClass} mt-0 max-w-36`}><option value="group">Gruppo AND/OR</option><option value="comparison">Confronto</option><option value="not">NOT</option></select><select aria-label="Operatore del gruppo" value={value.operator} onChange={(event) => onChange({ ...value, operator: event.target.value as "AND" | "OR" })} className={`${inputClass} mt-0 max-w-28`}><option value="AND">Tutte (AND)</option><option value="OR">Una (OR)</option></select>{onRemove && <button type="button" onClick={onRemove} aria-label="Rimuovi gruppo" className="ml-auto rounded p-1 text-slate-600 hover:text-red-300"><Trash2 size={13}/></button>}</div>
    <div className="mt-2 space-y-2 border-l border-[#33444e] pl-2">{value.conditions.map((condition, index) => <ConditionNodeEditor key={index} value={condition} onChange={(next) => onChange({ ...value, conditions: value.conditions.map((item, position) => position === index ? next : item) })} onRemove={value.conditions.length > 1 ? () => onChange({ ...value, conditions: value.conditions.filter((_, position) => position !== index) }) : undefined} apiParameters={apiParameters} nodes={nodes} previousNodes={previousNodes} currentNodeId={currentNodeId} variables={variables} loopOptions={loopOptions} depth={depth + 1}/>)}</div>
    <div className="mt-2 flex flex-wrap gap-1.5"><AddButton label="Confronto" onClick={() => onChange({ ...value, conditions: [...value.conditions, makeComparison()] })}/><AddButton label="Gruppo" onClick={() => onChange({ ...value, conditions: [...value.conditions, { kind: "group", operator: "AND", conditions: [makeComparison()] }] })}/><AddButton label="NOT" onClick={() => onChange({ ...value, conditions: [...value.conditions, { kind: "not", condition: makeComparison() }] })}/></div>
  </div>;
}

function OperandEditor({ label, value, type, apiParameters, previousNodes, variables, loopOptions, onChange }: {
  label: string;
  value: unknown;
  type: string;
  apiParameters: ApiParameter[];
  previousNodes: BatchNode[];
  variables: BatchVariable[];
  loopOptions: Array<[string, string]>;
  onChange: (value: unknown) => void;
}) {
  const binding = isParameterBinding(value) ? value : null;
  const mode = binding?.source === "api" || binding?.source === "node" || binding?.source === "variable" || binding?.source === "loop" ? binding.source : "constant";
  const apiOptions = apiParameters.filter((item) => isCompatibleParameterType(type, item.type) || item.type === "json");
  const variableOptions = variables;
  const nodeOptions = previousNodes.flatMap((node) => {
    const definition = getBlockDefinition(node.data.toolId, node.data.toolVersion);
    return (definition?.outputs ?? []).filter((port) => port.type !== "control").map((port) => ({ node, port }));
  });
  const literal = binding?.source === "constant" ? binding.value : value;
  const pathBinding = binding && (binding.source === "api" || binding.source === "node" || binding.source === "variable") ? binding : null;
  const bindingPath = pathBinding?.path?.join(".") ?? "";
  return <label className="block min-w-0 text-[8px] text-slate-500">{label}
    <select aria-label={`Origine ${label}`} value={mode} onChange={(event) => {
      const next = event.target.value;
      if (next === "constant") onChange(null);
      else if (next === "api") onChange({ source: "api", name: "" });
      else if (next === "variable") onChange({ source: "variable", name: "" });
      else if (next === "loop") onChange({ source: "loop", name: "currentPage" });
      else onChange({ source: "node", nodeId: "", port: "" });
    }} className={inputClass}><option value="constant">Valore costante</option>{apiOptions.length > 0 && <option value="api">Parametro API</option>}{nodeOptions.length > 0 && <option value="node">Output precedente</option>}{variableOptions.length > 0 && <option value="variable">Variabile</option>}{loopOptions.length > 0 && <option value="loop">Variabile loop</option>}</select>
    {mode === "api" && <select aria-label={`Binding API ${label}`} value={binding?.source === "api" ? binding.name : ""} onChange={(event) => onChange(event.target.value ? { source: "api", name: event.target.value } : { source: "api", name: "" })} className={inputClass}><option value="">Seleziona parametro</option>{apiOptions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.type}</option>)}</select>}
    {mode === "node" && <select aria-label={`Binding nodo ${label}`} value={binding?.source === "node" ? `${binding.nodeId}:${binding.port}` : ""} onChange={(event) => { const [nodeId, port] = event.target.value.split(":"); onChange(nodeId && port ? { source: "node", nodeId, port } : { source: "node", nodeId: "", port: "" }); }} className={inputClass}><option value="">Seleziona output</option>{nodeOptions.map(({ node, port }) => <option key={`${node.id}:${port.id}`} value={`${node.id}:${port.id}`}>{node.data.label} · {port.label} ({port.type})</option>)}</select>}
    {mode === "variable" && <select aria-label={`Binding variabile ${label}`} value={binding?.source === "variable" ? binding.name : ""} onChange={(event) => onChange(event.target.value ? { source: "variable", name: event.target.value } : { source: "variable", name: "" })} className={inputClass}><option value="">Seleziona variabile</option>{variableOptions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.type}</option>)}</select>}
    {mode === "loop" && <select aria-label={`Binding loop ${label}`} value={binding?.source === "loop" ? binding.name === "item" && binding.path?.length ? `item.${binding.path.join(".")}` : binding.name : ""} onChange={(event) => { const selected = event.target.value; const itemPath = selected.startsWith("item.") ? selected.slice(5).split(".") : []; onChange(selected ? { source: "loop", name: itemPath.length ? "item" : selected, ...(itemPath.length ? { path: itemPath } : {}) } : { source: "loop", name: "" }); }} className={inputClass}><option value="">Seleziona variabile loop</option>{loopOptions.filter(([, candidateType]) => isCompatibleParameterType(type, candidateType as Parameters<typeof isCompatibleParameterType>[1])).map(([name, candidateType]) => <option key={name} value={name}>{name} · {candidateType}</option>)}</select>}
    {pathBinding && <input aria-label={`Percorso proprietà ${label}`} value={bindingPath} onChange={(event) => { const path = event.target.value.split(".").map((part) => part.trim()).filter(Boolean); onChange({ ...pathBinding, ...(path.length ? { path } : { path: undefined }) }); }} placeholder="Percorso proprietà · es. 0.text o Title" className={inputClass}/>}
    {mode === "constant" && <LiteralEditor type={type} value={literal} onChange={onChange}/>}
  </label>;
}

function LiteralEditor({ type, value, onChange }: { type: string; value: unknown; onChange: (value: unknown) => void }) {
  const [jsonText, setJsonText] = useState(() => value === undefined ? (type === "array" ? "[]" : type === "object" ? "{}" : "") : JSON.stringify(value, null, 2));
  if (value === null) return <button type="button" onClick={() => onChange(type === "array" ? [] : type === "object" ? {} : type === "number" ? 0 : type === "boolean" ? false : "")} className={`${inputClass} text-left text-[#85a6d8]`}>null · clicca per impostare un valore</button>;
  if (type === "boolean") return <select aria-label="Valore booleano" value={String(value ?? false)} onChange={(event) => onChange(event.target.value === "true")} className={inputClass}><option value="true">true</option><option value="false">false</option></select>;
  if (type === "number") return <input aria-label="Valore numerico" type="number" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} className={inputClass}/>;
  if (type === "array" || type === "object") return <textarea aria-label="Valore JSON" rows={3} value={jsonText} onChange={(event) => { setJsonText(event.target.value); try { const parsed: unknown = JSON.parse(event.target.value); if (type === "array" ? Array.isArray(parsed) : Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed))) onChange(parsed); } catch { /* Keep the last valid value until the JSON is complete. */ } }} className={`${inputClass} font-mono`}/>;
  return <input aria-label="Valore testuale" type="text" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} className={inputClass}/>;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded border border-[#313c4c] px-2 py-1 text-[8px] text-slate-400 hover:border-[#4c5e78] hover:text-[#8caee0]"><Plus size={10}/>{label}</button>;
}

function makeComparison(): CompareNode {
  return { kind: "comparison", leftType: "string", rightType: "string", left: "", right: "", operator: "eq", caseSensitive: false, nullBehavior: "equalOnly" };
}
