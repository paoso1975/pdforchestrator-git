"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge, Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  useEdgesState, useNodesState, type Connection, type EdgeProps, type NodeProps,
} from "@xyflow/react";
import {
  AlertCircle, ArrowDownToLine, ArrowRight, Check, CopyPlus, Download, FileUp,
  ChevronDown, Clock3, Copy, FlaskConical, LoaderCircle, MoreHorizontal,
  Play, Plus, Redo2, Save, Search, Settings2, Sparkles, Trash2, Undo2, Upload, X,
} from "lucide-react";
import Link from "next/link";
import { batchDraftExportSchema, isWithinBatchDraftLimit, MAX_BATCH_DRAFT_BYTES } from "@/lib/schemas/batch-draft-export";
import { batchGraphSchema } from "@/lib/schemas/api";
import { batchEditorSnapshotKey, hasUnsavedBatchEditorChanges } from "@/lib/batch-editor-state";
import { useRouter } from "next/navigation";
import { autoLayout, canConnect, createNode, insertNodeOnBatchEdge, makeBatchEdge, reconnectBatchEdge, serializeGraph, validateGraph, validateStructure, type ApiParameter, type BatchEdge, type BatchNode, type BatchVariable, type BatchViewport } from "@/lib/batch-graph";
import { latestBlockRegistry, getBlockDefinition, type BlockPort, type BlockPortType } from "@/lib/blocks/registry";
import { BlockParameterInspector } from "@/components/block-parameter-inspector";
import { apiRequestExample, exampleExecutionOutput, generateApiDefinition, makeOutputSchema, parametersFromSchema } from "@/lib/api-schema";
import "@xyflow/react/dist/style.css";

type BatchInfo = { id: string; name: string; slug: string; status: string; updatedAt: string; organizationId: string };
type BatchVersion = { id: string; version: number; revision?: number; graph: unknown; inputSchema: unknown; outputSchema: unknown; publishedAt: string | null; createdAt: string };
type Snapshot = { nodes: BatchNode[]; edges: BatchEdge[]; variables: BatchVariable[] };

const categoryNames: Record<string, string> = {
  input: "Input", output: "Output", pages: "Pagine", analysis: "Analisi",
  metadata: "Metadati", flow: "Flusso", loop: "Cicli",
};
const initialParameters: ApiParameter[] = [];

function BatchNodeView({ data, selected }: NodeProps<BatchNode>) {
  const tool = getBlockDefinition(data.toolId, data.toolVersion);
  const Icon = tool?.icon ?? Sparkles;
  const summary = Object.entries(data.parameters).slice(0, 2).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ");
  return <div role="group" aria-label={`${data.label}, ${data.toolId} versione ${data.toolVersion}${summary ? `, ${summary}` : ""}`} className={`min-w-56 overflow-hidden rounded-xl border bg-[#101923] shadow-xl ${selected ? "border-[#5187d8] ring-1 ring-[#5187d8]/25" : "border-[#293744]"}`} style={{ borderColor: selected ? undefined : tool?.color.border }}>
    <div className="h-1" style={{ backgroundColor: tool?.color.accent }} />
    {tool?.inputs.map((port) => <div key={port.id} className="relative flex h-5 items-center pl-3 text-[10px] text-slate-500">
      <Handle type="target" position={Position.Left} id={port.id} title={`Ingresso ${port.label}, tipo ${port.type}${port.required ? ", obbligatorio" : ""}`} className={`!h-2.5 !w-2.5 !border !bg-[#101923] ${port.type === "control" ? "!border-[#d6a25a]" : "!border-[#55667f]"}`} />{port.label} <span className={`ml-auto mr-3 ${port.type === "control" ? "text-[#e9b768]" : "text-[#71839f]"}`}>{flowPort(port.type)}</span>
    </div>)}
    <div className="flex items-center gap-3 px-3 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: tool?.color.surface, color: tool?.color.accent }}><Icon size={17} /></span><div className="min-w-0"><p className="truncate text-[13px] font-semibold text-slate-100">{data.label}</p><p className="mt-0.5 text-[10px] text-slate-500">{data.toolId} · v{data.toolVersion}</p>{summary && <p className="mt-1 max-w-48 truncate text-[9px] text-slate-400" title={summary}>{summary}</p>}</div></div>
    {tool?.outputs.map((port) => <div key={port.id} className="relative flex h-5 items-center justify-end pr-3 text-[10px] text-slate-500"><span className={`mr-2 ${port.type === "control" ? "text-[#e9b768]" : "text-[#71839f]"}`}>{flowPort(port.type)}</span>{port.label}<Handle type="source" position={Position.Right} id={port.id} title={`Uscita ${port.label}, tipo ${port.type}`} className={`!h-2.5 !w-2.5 !border !bg-[#101923] ${port.type === "control" ? "!border-[#d6a25a]" : "!border-[#55667f]"}`} /></div>)}
  </div>;
}

function flowPort(type: BlockPortType) { return ({ control: "CTRL", document: "PDF", documentList: "PDF LIST", string: "TESTO", number: "NUMERO", boolean: "BOOL", object: "OGGETTO", array: "LISTA" })[type]; }
const nodeTypes = { tool: BatchNodeView };

function BatchEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, animated }: EdgeProps<BatchEdge>) {
  const routing = data?.routing ?? "smoothstep";
  const [path, labelX, labelY] = routing === "bezier"
    ? getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <>
    <BaseEdge id={id} path={path} markerEnd={typeof markerEnd === "string" ? markerEnd : MarkerType.ArrowClosed} className={animated ? "pfo-edge-animated" : undefined} style={{ stroke: data?.kind === "control" ? "#f1b86d" : "#4079cf", strokeWidth: selected ? 2.6 : 1.8, strokeDasharray: data?.kind === "control" || animated ? "5 4" : undefined }} />
    {data?.label && <EdgeLabelRenderer><div className="nodrag nopan absolute rounded border border-[#36424c] bg-[#111b25] px-1.5 py-0.5 text-[9px] text-slate-300" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{data.label}</div></EdgeLabelRenderer>}
  </>;
}
const edgeTypes = { batch: BatchEdgeView };

function Editor({ batchId, initialBatch }: { batchId: string; initialBatch: BatchInfo }) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<BatchNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BatchEdge>([]);
  const [viewport, setViewport] = useState<BatchViewport>({ x: 0, y: 0, zoom: 1 });
  const [edgeContext, setEdgeContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edgeRouting, setEdgeRouting] = useState<"smoothstep" | "bezier">("smoothstep");
  const [animateEdges, setAnimateEdges] = useState(false);
  const [batch, setBatch] = useState(initialBatch);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [parameters, setParameters] = useState<ApiParameter[]>(initialParameters);
  const [variables, setVariables] = useState<BatchVariable[]>([]);
  const [versions, setVersions] = useState<BatchVersion[]>([]);
  const [panel, setPanel] = useState<"issues" | "parameters" | "test" | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [saveState, setSaveState] = useState("Salvato");
  const [savedSnapshotKey, setSavedSnapshotKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(initialBatch.name);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [engineNotice, setEngineNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const savingRef = useRef(false);
  const savedSnapshotRef = useRef<string | null>(null);
  const latest = useRef({ nodes, edges, viewport, parameters, variables, batch, draftRevision });
  useEffect(() => { latest.current = { nodes, edges, viewport, parameters, variables, batch, draftRevision }; }, [nodes, edges, viewport, parameters, variables, batch, draftRevision]);

  const selected = nodes.find((node) => node.id === selectedNode) ?? null;
  const selectedTool = selected ? getBlockDefinition(selected.data.toolId, selected.data.toolVersion) : null;
  const apiDefinition = useMemo(() => generateApiDefinition(nodes, parameters), [nodes, parameters]);
  const issues = useMemo(() => initialized ? [...validateGraph(nodes, edges), ...apiDefinition.issues.map((issue) => issue.message)] : [], [initialized, nodes, edges, apiDefinition]);
  const currentSnapshotKey = useMemo(() => batchEditorSnapshotKey({ nodes, edges, viewport, variables, parameters, batchName: batch.name }), [nodes, edges, viewport, variables, parameters, batch.name]);
  const isDirty = initialized && hasUnsavedBatchEditorChanges(savedSnapshotKey, currentSnapshotKey);
  const filteredTools = useMemo(() => latestBlockRegistry.filter((tool) =>
    (activeCategory === "all" || tool.category === activeCategory) &&
    `${tool.label} ${tool.type} ${tool.description}`.toLowerCase().includes(search.toLowerCase()),
  ), [activeCategory, search]);

  const pushUndo = useCallback(() => {
    setUndoStack((stack) => [...stack.slice(-39), { nodes: latest.current.nodes, edges: latest.current.edges, variables: latest.current.variables }]);
    setRedoStack([]);
  }, []);

  const save = useCallback(async (publish = false): Promise<boolean> => {
    if (savingRef.current) return false;
    const state = latest.current;
    const contract = generateApiDefinition(state.nodes, state.parameters);
    const validation = [...validateGraph(state.nodes, state.edges), ...contract.issues.map((issue) => issue.message)];
    if (publish && validation.length) {
      setPanel("issues"); setSaveState("Correggi gli errori prima di pubblicare"); return false;
    }
    savingRef.current = true; setSaving(true); setSaveState(publish ? "Pubblicazione…" : "Salvataggio…");
    try {
      const serialized = serializeGraph(state.nodes, state.edges, state.viewport, state.variables);
      const inputSchema = contract.inputSchema;
      const outputSchema = makeOutputSchema();
      const response = publish ? await fetch(`/api/batches/${batchId}/versions`, {
        method: "POST", headers: { "Content-Type": "application/json", "If-Match": `"${new Date(state.batch.updatedAt).toISOString()}"` },
        body: JSON.stringify({ graph: serialized, inputSchema, outputSchema, toolManifest: [], publish: true, batchName: state.batch.name }),
      }) : await fetch(`/api/batches/${batchId}/draft`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: state.draftRevision, graph: serialized, inputSchema, outputSchema, batchName: state.batch.name }),
      });
      const result = await response.json() as BatchVersion & { error?: string; updatedAt?: string };
      if (response.status === 409 || response.status === 412) {
        setSaveState("Conflitto: batch modificato altrove"); setEngineNotice("Il server ha rilevato una modifica concorrente. Ricarica la pagina per continuare."); return false;
      }
      if (!response.ok) throw new Error(result.error ?? "Salvataggio non riuscito.");
      const refreshed = await fetch(`/api/batches/${batchId}`, { cache: "no-store" });
      if (refreshed.ok) {
        const current = await refreshed.json() as BatchInfo;
        setBatch(current); latest.current.batch = current;
      }
      const versionResponse = await fetch(`/api/batches/${batchId}/versions`, { cache: "no-store" });
      if (versionResponse.ok) setVersions(await versionResponse.json() as BatchVersion[]);
      if (publish) { setDraftRevision(null); latest.current.draftRevision = null; }
      else { setDraftRevision(result.revision ?? null); latest.current.draftRevision = result.revision ?? null; }
      const persistedSnapshotKey = batchEditorSnapshotKey({ ...state, batchName: state.batch.name });
      savedSnapshotRef.current = persistedSnapshotKey;
      setSavedSnapshotKey(persistedSnapshotKey);
      setSaveState(publish ? `Pubblicata · v${result.version}` : "Tutte le modifiche salvate");
      if (publish) setBatch((current) => ({ ...current, status: "PUBLISHED" }));
      return true;
    } catch (cause) {
      setSaveState("Errore di salvataggio"); setEngineNotice(cause instanceof Error ? cause.message : "Errore di rete.");
      return false;
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }, [batchId]);

  const requestNavigation = useCallback((destination: string) => {
    if (isDirty) {
      setPendingNavigation(destination);
      setExitDialogOpen(true);
      return;
    }
    router.push(destination);
  }, [isDirty, router]);

  const duplicateBatch = useCallback(async (confirmed = false) => {
    if (isDirty && !confirmed) {
      setPendingNavigation("__duplicate__");
      setExitDialogOpen(true);
      return;
    }
    setEngineNotice("");
    try {
      const response = await fetch(`/api/batches/${batchId}/duplicate`, { method: "POST" });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Impossibile duplicare il batch.");
      router.push(`/dashboard/batches/${result.id}/edit`);
    } catch (cause) { setEngineNotice(cause instanceof Error ? cause.message : "Errore di rete."); }
  }, [batchId, isDirty, router]);

  const saveAndNavigate = useCallback(async () => {
    const destination = pendingNavigation ?? "/dashboard/batches";
    const saved = await save(false);
    if (!saved) return;
    const current = latest.current;
    const latestKey = batchEditorSnapshotKey({ ...current, batchName: current.batch.name });
    if (latestKey === savedSnapshotRef.current) {
      if (destination === "__duplicate__") await duplicateBatch(true);
      else router.push(destination);
    }
    else {
      setExitDialogOpen(false);
      setPendingNavigation(null);
      setEngineNotice("Sono state modificate altre impostazioni durante il salvataggio. Salvale prima di uscire.");
    }
  }, [duplicateBatch, pendingNavigation, router, save]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`);
      setExitDialogOpen(true);
    };
    window.document.addEventListener("click", onDocumentClick, true);
    return () => window.document.removeEventListener("click", onDocumentClick, true);
  }, [isDirty]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [batchResponse, versionResponse, draftResponse] = await Promise.all([
          fetch(`/api/batches/${batchId}`, { cache: "no-store" }),
          fetch(`/api/batches/${batchId}/versions`, { cache: "no-store" }),
          fetch(`/api/batches/${batchId}/draft`, { cache: "no-store" }),
        ]);
        if (!batchResponse.ok) throw new Error("Batch non disponibile o accesso negato.");
        const current = await batchResponse.json() as BatchInfo & { versions?: BatchVersion[] };
        const loadedVersions = versionResponse.ok ? await versionResponse.json() as BatchVersion[] : current.versions ?? [];
        const savedDraft = draftResponse.ok ? await draftResponse.json() as (BatchVersion & { batchName: string }) | null : null;
        if (!active) return;
        setBatch(current); latest.current.batch = current; setVersions(loadedVersions);
        const draft = savedDraft ?? loadedVersions.find((version) => !version.publishedAt) ?? loadedVersions[0];
        let loadedNodes: BatchNode[] = [];
        let loadedEdges: BatchEdge[] = [];
        let loadedVariables: BatchVariable[] = [];
        let loadedParameters: ApiParameter[] = [];
        let loadedViewport: BatchViewport = { x: 0, y: 0, zoom: 1 };
        let loadedName = current.name;
        if (draft) {
          const graph = batchGraphSchema.parse(draft.graph);
          loadedNodes = graph.nodes as BatchNode[];
          loadedEdges = graph.edges as BatchEdge[];
          loadedVariables = graph.variables ?? [];
          loadedName = savedDraft?.batchName ?? current.name;
          setNodes(loadedNodes); setEdges(loadedEdges);
          setVariables(loadedVariables);
          setDraftRevision(savedDraft?.revision ?? null);
          latest.current.draftRevision = savedDraft?.revision ?? null;
          if (graph.viewport && Number.isFinite(graph.viewport.x) && Number.isFinite(graph.viewport.y) && Number.isFinite(graph.viewport.zoom)) loadedViewport = graph.viewport;
          setViewport(loadedViewport);
          const input = draft.inputSchema as { properties?: Record<string, { type?: string; description?: string; default?: unknown; minimum?: number; maximum?: number }>; required?: string[] };
          if (input.properties) loadedParameters = parametersFromSchema(draft.inputSchema);
          setParameters(loadedParameters);
        }
        if (loadedName !== current.name) setBatch({ ...current, name: loadedName });
        const baseline = batchEditorSnapshotKey({ nodes: loadedNodes, edges: loadedEdges, viewport: loadedViewport, variables: loadedVariables, parameters: loadedParameters, batchName: loadedName });
        savedSnapshotRef.current = baseline;
        setSavedSnapshotKey(baseline);
        setInitialized(true);
      } catch (cause) { setEngineNotice(cause instanceof Error ? cause.message : "Impossibile caricare il batch."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [batchId, setEdges, setNodes]);

  const addTool = useCallback((toolId: string, position: { x: number; y: number }) => {
    const node = createNode(toolId, position);
    if (!node) return;
    pushUndo(); setNodes((current) => [...current, node]); setSelectedNode(node.id);
  }, [pushUndo, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    if (!canConnect(connection, nodes, edges)) { setEngineNotice("Collegamento rifiutato: porte incompatibili, duplicato o ciclo."); return; }
    const edge = makeBatchEdge(connection, nodes, { routing: edgeRouting, animated: animateEdges });
    if (!edge) { setEngineNotice("Collegamento non valido: controlla porte e direzione."); return; }
    setEngineNotice(""); pushUndo(); setEdges((current) => addEdge(edge, current));
  }, [animateEdges, edgeRouting, edges, nodes, pushUndo, setEdges]);

  const onReconnect = useCallback((oldEdge: BatchEdge, connection: Connection) => {
    const replacement = reconnectBatchEdge(oldEdge, connection, nodes, edges);
    if (!replacement) { setEngineNotice("Ricollegamento rifiutato: porte incompatibili, duplicato o ciclo."); return; }
    pushUndo(); setEdges((current) => current.map((edge) => edge.id === oldEdge.id ? replacement : edge)); setEngineNotice("");
  }, [edges, nodes, pushUndo, setEdges]);

  const insertOnEdge = useCallback((toolId: string) => {
    if (!edgeContext) return;
    const edge = edges.find((item) => item.id === edgeContext.id);
    if (!edge) return;
    const source = nodes.find((item) => item.id === edge.source);
    const target = nodes.find((item) => item.id === edge.target);
    if (!source || !target) return;
    const result = insertNodeOnBatchEdge(edge, toolId, { x: (source.position.x + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 }, nodes, edges);
    if (!result) { setEngineNotice(`Impossibile inserire ${toolId}: porte non compatibili con questo collegamento.`); return; }
    pushUndo(); setNodes((current) => [...current, result.node]); setEdges(result.edges); setSelectedNode(result.node.id); setEdgeContext(null);
  }, [edgeContext, edges, nodes, pushUndo, setEdges, setNodes]);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      setRedoStack((redo) => [...redo, { nodes, edges, variables }]);
      const prior = stack.at(-1)!; setNodes(prior.nodes); setEdges(prior.edges); setVariables(prior.variables); return stack.slice(0, -1);
    });
  }, [edges, nodes, setEdges, setNodes, variables]);
  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      setUndoStack((undoList) => [...undoList, { nodes, edges, variables }]);
      const next = stack.at(-1)!; setNodes(next.nodes); setEdges(next.edges); setVariables(next.variables); return stack.slice(0, -1);
    });
  }, [edges, nodes, setEdges, setNodes, variables]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key === "Delete" || event.key === "Backspace") {
        const target = event.target as HTMLElement;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
        if (nodes.some((node) => node.selected) || edges.some((edge) => edge.selected)) pushUndo();
      }
    }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [edges, nodes, pushUndo, redo, save, undo]);

  const duplicateSelected = () => {
    const selectedNodes = nodes.filter((node) => node.selected);
    const targets = selectedNodes.length ? selectedNodes : selected ? [selected] : [];
    if (!targets.length) return;
    pushUndo();
    const duplicates = targets.map((node, index) => ({ ...node, id: crypto.randomUUID(), position: { x: node.position.x + 40 + index * 12, y: node.position.y + 40 + index * 12 }, selected: true, data: { ...node.data, parameters: { ...node.data.parameters } } }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...duplicates]); setSelectedNode(duplicates[0].id);
  };
  const patchNodeParameters = (key: string, value: unknown) => setNodes((current) => current.map((node) => node.id === selected?.id ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, [key]: value } } } : node));
  const patchParameter = (name: string, patch: Partial<ApiParameter>) => setParameters((current) => {
    const existing = current.find((parameter) => parameter.name === name) ?? apiDefinition.parameters.find((parameter) => parameter.name === name);
    return current.some((parameter) => parameter.name === name)
      ? current.map((parameter) => parameter.name === name ? { ...parameter, ...patch } : parameter)
      : existing ? [...current, { ...existing, ...patch }] : current;
  });
  const removeParameter = (name: string) => setParameters((current) => current.filter((parameter) => parameter.name !== name));
  const addParameter = () => setParameters((current) => { let index = current.length + 1; while (apiDefinition.parameters.some((parameter) => parameter.name === "parametro_" + index)) index++; return [...current, { name: "parametro_" + index, type: "string", description: "", required: false }]; });

  const exportDraft = () => {
    const exportValue = batchDraftExportSchema.parse({ formatVersion: 1, batchName: batch.name, graph: serializeGraph(nodes, edges, viewport, variables), inputSchema: apiDefinition.inputSchema, outputSchema: makeOutputSchema() });
    const text = JSON.stringify(exportValue, null, 2);
    if (!isWithinBatchDraftLimit(text)) { setEngineNotice("Il draft supera il limite di esportazione di 5 MiB."); return; }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${batch.slug || "batch"}.pfo.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const importDraft = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BATCH_DRAFT_BYTES) { setEngineNotice("Il file supera il limite di 5 MiB."); return; }
    try {
      const text = await file.text();
      if (!isWithinBatchDraftLimit(text)) throw new Error("Il file supera il limite di 5 MiB.");
      const imported = batchDraftExportSchema.parse(JSON.parse(text));
      const structureIssues = validateStructure(imported.graph.nodes as BatchNode[], imported.graph.edges as BatchEdge[]);
      const unsupported = imported.graph.nodes.filter((node) => !getBlockDefinition(node.data.toolId, node.data.toolVersion)).map((node) => `${node.data.toolId}@${node.data.toolVersion}`);
      if (structureIssues.length || unsupported.length) throw new Error([...structureIssues, ...unsupported.map((tool) => `Strumento non riconosciuto: ${tool}.`)].join(" "));
      pushUndo(); setNodes(imported.graph.nodes as BatchNode[]); setEdges(imported.graph.edges as BatchEdge[]); setVariables(imported.graph.variables ?? []);
      if (imported.graph.viewport) setViewport(imported.graph.viewport);
      setParameters(parametersFromSchema(imported.inputSchema));
      setBatch((current) => ({ ...current, name: imported.batchName })); setEngineNotice(""); setSaveState("Importato · modifiche non salvate");
    } catch (cause) { setEngineNotice(cause instanceof Error ? cause.message : "File JSON non valido."); }
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false);
    const toolId = event.dataTransfer.getData("application/pdf-orchestrator-tool");
    if (toolId) addTool(toolId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const onDragStartTool = (event: React.DragEvent, toolId: string) => { event.dataTransfer.setData("application/pdf-orchestrator-tool", toolId); event.dataTransfer.effectAllowed = "move"; };

  return <div className="flex h-dvh min-h-[680px] flex-col overflow-hidden bg-[#0a1017] text-slate-200">
    <header className="z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-[#25313c] bg-[#0d151e] px-5">
      <Link href="/dashboard/batches" className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-tight"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#17253a] text-[#6b9ae0]"><Sparkles size={16}/></span><span className="hidden sm:inline">PDF<span className="text-[#6997dc]">Orchestrator</span></span></Link>
      <span className="h-7 w-px bg-[#2a3742]" />
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="max-w-sm truncate text-sm font-semibold text-slate-100" title={batch.name}>{batch.name}</span><span className={`h-1.5 w-1.5 rounded-full ${batch.status === "PUBLISHED" ? "bg-emerald-400" : "bg-amber-400"}`}/></div><div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">{batch.status === "PUBLISHED" ? "Pubblicato" : "Bozza"}<span>·</span><span>v{versions[0]?.version ?? "—"}</span><span>·</span><span>rev {draftRevision ?? "—"}</span><span>·</span><span className={isDirty ? "text-[#7eafff]" : ""}>{saving ? "Salvataggio…" : isDirty ? "Modifiche non salvate" : saveState}</span></div></div>
      <div className="hidden items-center gap-1.5 lg:flex"><button onClick={undo} disabled={!undoStack.length} className="icon-btn" title="Annulla (Ctrl+Z)"><Undo2 size={16}/></button><button onClick={redo} disabled={!redoStack.length} className="icon-btn" title="Ripeti (Ctrl+Y)"><Redo2 size={16}/></button><button onClick={() => { pushUndo(); setNodes((current) => autoLayout(current, edges)); }} disabled={!nodes.length} className="icon-btn" title="Disponi automaticamente i nodi"><Sparkles size={15}/></button><button onClick={() => { const input = window.document.createElement("input"); input.type = "file"; input.accept = "application/json,.json"; input.onchange = () => { void importDraft(input.files?.[0]); }; input.click(); }} className="icon-btn" title="Importa draft JSON"><FileUp size={15}/></button><button onClick={exportDraft} className="icon-btn" title="Esporta draft JSON"><Download size={15}/></button></div>
      <button onClick={() => { void save(false); }} disabled={saving || loading || !isDirty} className={isDirty ? "rounded-md border border-[#136EF9] bg-[#136EF9] px-3 py-2 text-xs font-semibold text-white shadow-[0_0_14px_rgba(19,110,249,0.35)] transition-colors hover:bg-[#0f5fdc] disabled:cursor-not-allowed disabled:opacity-50" : "editor-secondary"}><Save size={14}/><span className="hidden sm:inline">Salva</span></button>
      <button onClick={() => { setRenameValue(batch.name); setRenameOpen(true); }} disabled={saving || loading} className="editor-secondary"><span>Rinomina</span></button>
      <button onClick={() => { setSelectedNode(null); setPanel("issues"); }} className="editor-secondary"><Check size={14}/><span className="hidden sm:inline">Valida</span></button>
      <button onClick={() => { setPanel("test"); setMobilePanelOpen(true); }} className="editor-secondary"><FlaskConical size={14}/><span className="hidden md:inline">Testa</span></button>
      <button onClick={() => setMobilePanelOpen((open) => !open)} className="editor-secondary md:hidden"><Settings2 size={14}/></button>
      <button onClick={() => { void save(true); }} disabled={saving} className="editor-primary"><ArrowDownToLine size={14}/><span className="hidden sm:inline">Pubblica</span></button>
      <button onClick={() => void duplicateBatch()} className="editor-secondary" title="Duplica batch"><CopyPlus size={14}/><span className="hidden xl:inline">Duplica</span></button><Link href={`/dashboard/batches/${batchId}/versions`} className="editor-secondary"><Clock3 size={14}/><span className="hidden md:inline">Versioni</span></Link>
      <button onClick={() => requestNavigation("/dashboard/batches")} className="editor-secondary"><span>Esci</span></button>
    </header>

    <div className="flex min-h-0 flex-1">
      <aside className="z-10 flex w-[248px] shrink-0 flex-col border-r border-[#25313c] bg-[#0e1720] max-md:w-[210px] max-sm:w-[64px]">
        <div className="border-b border-[#25313c] p-3 max-sm:p-2"><div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-[.13em] text-slate-400 max-sm:hidden">Strumenti</p><button className="icon-btn"><MoreHorizontal size={15}/></button></div><div className="flex items-center gap-2 rounded-lg border border-[#293744] bg-[#111c27] px-2.5 py-2"><Search size={14} className="shrink-0 text-slate-500"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca strumenti" className="w-full bg-transparent text-xs outline-none placeholder:text-slate-600 max-sm:hidden" aria-label="Cerca strumenti"/></div></div>
        <div className="flex gap-1 overflow-x-auto border-b border-[#25313c] p-2 max-sm:flex-col">{["all", ...Object.keys(categoryNames)].map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 rounded-md px-2 py-1.5 text-[10px] ${activeCategory === category ? "bg-[#1b2739] text-[#77a0de]" : "text-slate-500 hover:bg-[#17232e] hover:text-slate-300"}`}>{category === "all" ? "Tutti" : categoryNames[category]}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{filteredTools.map((tool) => { const Icon = tool.icon; return <button key={`${tool.type}@${tool.version}`} draggable onDragStart={(event) => onDragStartTool(event, tool.type)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); addTool(tool.type, { x: 80 + nodes.length * 24, y: 80 + nodes.length * 24 }); } }} onClick={() => addTool(tool.type, { x: 80 + nodes.length * 24, y: 80 + nodes.length * 24 })} className="mb-1 flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left hover:border-[#293744] hover:bg-[#141f2a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#568ad8] active:cursor-grabbing" title={`${tool.label} — trascina nel canvas`} aria-label={`Aggiungi ${tool.label}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#182833] text-[#6492d7]"><Icon size={14}/></span><span className="min-w-0 max-sm:hidden"><span className="block truncate text-[11px] font-medium text-slate-200">{tool.label}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-slate-600">{tool.type} · v{tool.version}</span></span><Plus size={13} className="ml-auto shrink-0 text-slate-600 max-sm:hidden"/></button>; })}</div>
        <div className="border-t border-[#25313c] p-3 text-[10px] text-slate-600 max-sm:hidden">{latestBlockRegistry.length} strumenti · trascina per aggiungere</div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[#0b121a]">
        <div className="pointer-events-none absolute inset-0 z-[1] opacity-[.10]" style={{ backgroundImage: "radial-gradient(#8292a1 0.65px, transparent 0.65px)", backgroundSize: "20px 20px" }}/>
        <div onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} className={`absolute inset-0 z-[2] ${dragging ? "ring-2 ring-inset ring-[#568ad8]" : ""}`}>
          {loading ? <div className="flex h-full items-center justify-center text-xs text-slate-500"><LoaderCircle size={16} className="mr-2 animate-spin"/>Caricamento flusso…</div> : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} edgesReconnectable snapToGrid snapGrid={[16, 16]} defaultViewport={viewport} onMoveEnd={(_, nextViewport) => { setViewport(nextViewport); }} onNodesChange={(changes) => { if (changes.some((change) => change.type === "remove")) pushUndo(); onNodesChange(changes); }} onEdgesChange={(changes) => { if (changes.some((change) => change.type === "remove")) pushUndo(); onEdgesChange(changes); }} onNodeDragStart={pushUndo} onConnect={onConnect} onReconnect={onReconnect} isValidConnection={(connection) => canConnect(connection, nodes, edges)} onEdgeContextMenu={(event, edge) => { event.preventDefault(); setEdgeContext({ id: edge.id, x: event.clientX, y: event.clientY }); }} onNodeClick={(_, node) => { setSelectedNode(node.id); setPanel(null); setMobilePanelOpen(true); }} onPaneClick={() => { setSelectedNode(null); setEdgeContext(null); }} onSelectionChange={({ nodes: selectedNodes }) => { if (selectedNodes.length) setSelectedNode(selectedNodes[0].id); }} fitView={viewport.zoom === 1 && viewport.x === 0 && viewport.y === 0} minZoom={0.2} maxZoom={1.6} deleteKeyCode={["Backspace", "Delete"]} multiSelectionKeyCode={["Shift", "Control", "Meta"]} proOptions={{ hideAttribution: true }}>
            <Background color="#556372" gap={20} size={1} variant={undefined}/><Controls position="bottom-left" showInteractive={false}/><MiniMap position="bottom-right" pannable zoomable nodeColor="#2c4160" maskColor="rgba(7,12,18,.72)"/>
          </ReactFlow>}
        </div>
        {!nodes.length && !loading && <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center"><div className="rounded-2xl border border-dashed border-[#34424f] bg-[#0f1821]/85 px-8 py-7 text-center"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#162439] text-[#6392d8]"><Upload size={19}/></span><p className="mt-3 text-sm font-semibold text-slate-200">Componi il tuo flusso</p><p className="mt-1 text-xs text-slate-500">Trascina uno strumento qui oppure fai clic su una voce.</p><p className="mt-4 font-mono text-[10px] text-slate-600">INPUT <span className="text-[#568ad8]">→</span> TRASFORMA <span className="text-[#568ad8]">→</span> OUTPUT</p></div></div>}
        <div className="absolute left-4 top-4 z-[4] flex flex-wrap gap-2"><span className="rounded-md border border-[#263541] bg-[#111b25]/90 px-2.5 py-1.5 text-[10px] text-slate-500">{nodes.length} nodi</span><span className="rounded-md border border-[#263541] bg-[#111b25]/90 px-2.5 py-1.5 text-[10px] text-slate-500">{edges.length} connessioni</span><select aria-label="Instradamento collegamenti" value={edgeRouting} onChange={(event) => setEdgeRouting(event.target.value as "smoothstep" | "bezier")} className="rounded-md border border-[#263541] bg-[#111b25]/90 px-2 py-1 text-[10px] text-slate-400"><option value="smoothstep">Routing: smoothstep</option><option value="bezier">Routing: bezier</option></select><label className="flex items-center gap-1 rounded-md border border-[#263541] bg-[#111b25]/90 px-2 py-1 text-[10px] text-slate-400"><input type="checkbox" checked={animateEdges} onChange={(event) => setAnimateEdges(event.target.checked)} />Freccia animata</label></div>
        {edgeContext && <div role="menu" aria-label="Azioni collegamento" className="fixed z-50 w-60 rounded-lg border border-[#36424c] bg-[#101a24] p-2 shadow-xl" style={{ left: edgeContext.x, top: edgeContext.y }}><p className="px-2 py-1 text-[10px] font-semibold text-slate-300">Collegamento</p><select aria-label="Blocco da inserire" className="my-1 w-full rounded border border-[#2b3944] bg-[#0d151e] p-2 text-[10px]" defaultValue="" onChange={(event) => { if (event.target.value) insertOnEdge(event.target.value); }}><option value="">Inserisci blocco…</option>{latestBlockRegistry.map((tool) => <option key={`${tool.type}@${tool.version}`} value={tool.type}>{tool.label} · {tool.version}</option>)}</select><button role="menuitem" onClick={() => { pushUndo(); setEdges((current) => current.filter((edge) => edge.id !== edgeContext.id)); setEdgeContext(null); }} className="w-full rounded px-2 py-1.5 text-left text-[10px] text-red-300 hover:bg-red-950/30">Elimina collegamento</button><button role="menuitem" onClick={() => setEdgeContext(null)} className="w-full rounded px-2 py-1.5 text-left text-[10px] text-slate-400 hover:bg-[#1a2732]">Chiudi</button></div>}
      </main>

      <aside className={`z-10 flex w-[310px] shrink-0 flex-col border-l border-[#25313c] bg-[#0e1720] max-lg:w-[270px] max-md:fixed max-md:bottom-10 max-md:right-0 max-md:top-[68px] max-md:z-40 max-md:w-[min(340px,calc(100vw-64px))] ${mobilePanelOpen ? "max-md:flex" : "max-md:hidden"}`}>
        <div className="flex h-12 items-center justify-between border-b border-[#25313c] px-4"><div className="flex gap-4 text-xs"><button onClick={() => { setPanel("parameters"); setMobilePanelOpen(true); }} className={`font-medium ${panel === "parameters" ? "text-[#729cdb]" : "text-slate-500"}`}>API</button><button onClick={() => { setSelectedNode(null); setPanel("issues"); setMobilePanelOpen(true); }} className={`font-medium ${panel === "issues" ? "text-[#729cdb]" : "text-slate-500"}`}>Validazione</button></div><button onClick={() => { setSelectedNode(null); setMobilePanelOpen(false); }} className="icon-btn"><X size={14}/></button></div>
        {panel === "parameters" ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">Parametri API</h2><p className="mt-1 text-[11px] text-slate-500">Input richiesti per invocare il batch.</p></div><button className="icon-btn" onClick={addParameter} title="Aggiungi parametro"><Plus size={15}/></button></div><div className="mt-4 space-y-3">{apiDefinition.parameters.map((parameter) => <div key={parameter.name} className="rounded-lg border border-[#283642] bg-[#111b25] p-3"><div className="flex gap-2"><input value={parameter.name} disabled={parameter.inferred} onChange={(event) => patchParameter(parameter.name, { name: event.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" aria-label="Nome parametro"/><button className="text-slate-600 hover:text-red-300" disabled={parameter.inferred} onClick={() => removeParameter(parameter.name)}><Trash2 size={13}/></button></div><div className="mt-2 grid grid-cols-2 gap-2"><select value={parameter.type} disabled={parameter.inferred} onChange={(event) => patchParameter(parameter.name, { type: event.target.value as ApiParameter["type"] })} className="rounded-md border border-[#2a3945] bg-[#0e1720] px-2 py-1.5 text-[10px]">{["string", "number", "boolean", "file", "pdf", "pdf-list", "json", "array"].map((type) => <option key={type}>{type}</option>)}</select><label className="flex items-center gap-1.5 text-[10px] text-slate-500"><input type="checkbox" checked={parameter.required} disabled={parameter.inferred} onChange={(event) => patchParameter(parameter.name, { required: event.target.checked })}/> Obbligatorio</label></div><input value={parameter.description} onChange={(event) => patchParameter(parameter.name, { description: event.target.value })} placeholder="Descrizione" className="mt-2 w-full rounded-md border border-[#2a3945] bg-[#0e1720] px-2 py-1.5 text-[10px] outline-none"/><input value={parameter.defaultValue === undefined ? "" : typeof parameter.defaultValue === "object" ? JSON.stringify(parameter.defaultValue) : String(parameter.defaultValue)} onChange={(event) => patchParameter(parameter.name, { defaultValue: parseApiDefault(event.target.value, parameter.type) })} placeholder="Valore predefinito" className="mt-2 w-full rounded-md border border-[#2a3945] bg-[#0e1720] px-2 py-1.5 text-[10px] outline-none"/>{parameter.type === "number" && <div className="mt-2 grid grid-cols-2 gap-2"><input type="number" placeholder="Min" value={parameter.minimum ?? ""} onChange={(event) => patchParameter(parameter.name, { minimum: event.target.value === "" ? undefined : Number(event.target.value) })} className="rounded-md border border-[#2a3945] bg-[#0e1720] px-2 py-1.5 text-[10px]"/><input type="number" placeholder="Max" value={parameter.maximum ?? ""} onChange={(event) => patchParameter(parameter.name, { maximum: event.target.value === "" ? undefined : Number(event.target.value) })} className="rounded-md border border-[#2a3945] bg-[#0e1720] px-2 py-1.5 text-[10px]"/></div>}</div>)}</div><p className="mt-4 text-[10px] leading-5 text-slate-600">Gli input usati dai nodi e i file di ingresso sono dedotti automaticamente. I segreti restano negli header di autenticazione, mai nel body.</p>{apiDefinition.issues.length > 0 && <ul className="mt-3 space-y-1 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-[10px] text-amber-200">{apiDefinition.issues.map((issue) => <li key={issue.code + issue.parameter + issue.nodeId}>{issue.message}</li>)}</ul>}<ApiContractPreview batchId={batchId} inputSchema={apiDefinition.inputSchema} outputSchema={makeOutputSchema()}/></div> : panel === "test" ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1b2739] text-[#709bdc]"><FlaskConical size={17}/></div><h2 className="mt-3 text-sm font-semibold">Test del batch</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Prova la configurazione prima di pubblicarla.</p><div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200"><AlertCircle size={14} className="mb-1 inline mr-1.5"/>Il motore di elaborazione non è disponibile.</div><label className="mt-4 block text-[11px] font-medium text-slate-400">PDF di prova<input type="file" accept="application/pdf,.pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-[10px] file:mr-2 file:rounded-md file:border-0 file:bg-[#1d2839] file:px-2 file:py-1.5 file:text-[10px] file:text-[#89aadc]"/></label>{selectedFile && <p className="mt-2 truncate text-[10px] text-slate-500">{selectedFile.name}</p>}<div className="mt-4 space-y-3">{apiDefinition.parameters.map((parameter) => <label key={parameter.name} className="block text-[10px] text-slate-400">{parameter.name}{parameter.required && " *"}<input disabled placeholder={parameter.description} className="mt-1 w-full rounded-md border border-[#263541] bg-[#111b25] px-2 py-2 text-[10px] opacity-60"/></label>)}</div><button disabled className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1d2d44] px-3 py-2.5 text-xs font-semibold text-[#a0b8db] opacity-50"><Play size={13}/> Motore non disponibile</button><p className="mt-2 text-center text-[9px] text-slate-600">Nessun file caricato. Il test non avvia job.</p></div> : selected && selectedTool ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-start justify-between"><div><p className="font-mono text-[9px] text-slate-600">{selected.data.toolId} · v{selected.data.toolVersion}</p><h2 className="mt-1 text-sm font-semibold">{selected.data.label}</h2></div><div className="flex"><button onClick={duplicateSelected} className="icon-btn" title="Duplica"><Copy size={13}/></button><button onClick={() => { pushUndo(); setNodes((current) => current.filter((node) => node.id !== selected.id)); setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedNode(null); }} className="icon-btn text-red-400" title="Elimina"><Trash2 size={13}/></button></div></div><p className="mt-2 text-[11px] leading-5 text-slate-500">{selectedTool.description}</p><div className="mt-5 border-t border-[#263541] pt-4"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Parametri nodo</h3><BlockParameterInspector definition={selectedTool} values={selected.data.parameters} apiParameters={apiDefinition.parameters} nodes={nodes} edges={edges} currentNodeId={selected.id} variables={variables} onChange={patchNodeParameters}/><ContextVariablesEditor variables={variables} onChange={(next) => { pushUndo(); setVariables(next); }}/></div><div className="mt-5 border-t border-[#263541] pt-4"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Porte</h3><div className="mt-3 space-y-3"><Ports title="Input" ports={selectedTool.inputs}/><Ports title="Output" ports={selectedTool.outputs}/></div></div></div> : <div className="flex-1 p-4">{engineNotice && <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">{engineNotice}</div>}<div className="mt-4 rounded-lg border border-[#253540] bg-[#111a23] p-3"><p className="text-xs font-medium">Flusso batch</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Seleziona un nodo per modificarne i parametri, oppure definisci l&apos;input API del batch.</p></div><button onClick={() => setPanel("parameters")} className="mt-3 flex w-full items-center justify-between rounded-lg border border-[#293744] p-3 text-left text-xs hover:bg-[#131f29]">Parametri API <ArrowRight size={14} className="text-slate-500"/></button><button onClick={() => setPanel("issues")} className="mt-2 flex w-full items-center justify-between rounded-lg border border-[#293744] p-3 text-left text-xs hover:bg-[#131f29]">Validazione <span className="text-[10px] text-slate-500">{issues.length ? `${issues.length} errori` : "OK"}</span></button><button onClick={() => setPanel("test")} className="mt-2 flex w-full items-center justify-between rounded-lg border border-[#293744] p-3 text-left text-xs hover:bg-[#131f29]">Test batch <FlaskConical size={14} className="text-slate-500"/></button></div>}
      </aside>
    </div>

    <footer className="z-10 flex min-h-[40px] shrink-0 items-center gap-3 border-t border-[#25313c] bg-[#0d151e] px-4 text-[10px]"><button onClick={() => setPanel(panel === "issues" ? null : "issues")} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200"><span className={`h-1.5 w-1.5 rounded-full ${issues.length ? "bg-amber-400" : "bg-emerald-400"}`}/>{issues.length ? `${issues.length} problemi` : "Nessun problema"}<ChevronDown size={12}/></button><span className="text-slate-700">·</span><span className="text-slate-500">{nodes.length} nodi</span><span className={`ml-auto ${isDirty ? "text-[#7eafff]" : "text-slate-600"}`}>{saving ? "Salvataggio…" : isDirty ? "Modifiche da salvare" : "Tutte le modifiche salvate"}</span><button onClick={() => setPanel("issues")} className="text-slate-500 hover:text-[#739cd9]">Log</button></footer>
    {panel === "issues" && <div className="absolute bottom-10 left-[248px] z-30 w-[min(500px,calc(100vw-300px))] rounded-xl border border-[#2a3945] bg-[#101a24] p-3 shadow-2xl max-sm:left-16"><div className="flex items-center justify-between"><p className="text-xs font-semibold">Validazione grafo</p><button onClick={() => setPanel(null)}><X size={13}/></button></div>{issues.length ? <ul className="mt-2 space-y-1.5">{issues.map((issue) => <li key={issue} className="flex gap-2 text-[10px] text-amber-200"><AlertCircle size={12} className="shrink-0"/>{issue}</li>)}</ul> : <p className="mt-2 text-[10px] text-emerald-300">Nessun errore di configurazione.</p>}{engineNotice && <p className="mt-2 border-t border-[#263541] pt-2 text-[10px] text-amber-200">{engineNotice}</p>}</div>}
    {renameOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="rename-batch-title" className="w-full max-w-md rounded-xl border border-[#2b3a49] bg-[#101a24] p-5 shadow-2xl"><h2 id="rename-batch-title" className="text-base font-semibold text-white">Rinomina batch</h2><p className="mt-1 text-xs text-slate-400">Il nuovo nome sarà salvato insieme alle modifiche del draft.</p><form onSubmit={(event) => { event.preventDefault(); const name = renameValue.trim(); if (!name || name.length > 120) return; setBatch((current) => ({ ...current, name })); setRenameOpen(false); }}><label className="mt-4 block text-xs text-slate-300" htmlFor="rename-batch-input">Nome batch</label><input id="rename-batch-input" autoFocus maxLength={120} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="mt-1 w-full rounded-md border border-[#334455] bg-[#0a1118] px-3 py-2 text-sm text-white outline-none focus:border-[#136EF9]"/><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRenameOpen(false)} className="editor-secondary">Annulla</button><button type="submit" disabled={!renameValue.trim()} className="editor-primary">Applica nome</button></div></form></section></div>}
    {exitDialogOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"><section role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" className="w-full max-w-md rounded-xl border border-[#2b3a49] bg-[#101a24] p-5 shadow-2xl"><h2 id="unsaved-title" className="text-base font-semibold text-white">Modifiche non salvate</h2><p id="unsaved-description" className="mt-2 text-sm leading-6 text-slate-400">Vuoi salvare le modifiche prima di uscire? Se esci senza salvare, il draft corrente non verrà aggiornato.</p><div className="mt-5 flex flex-wrap justify-end gap-2"><button onClick={() => { setExitDialogOpen(false); setPendingNavigation(null); }} className="editor-secondary">Resta qui</button><button onClick={() => { const destination = pendingNavigation ?? "/dashboard/batches"; setExitDialogOpen(false); setPendingNavigation(null); if (destination === "__duplicate__") void duplicateBatch(true); else router.push(destination); }} className="editor-secondary">Esci senza salvare</button><button onClick={() => void saveAndNavigate()} disabled={saving} className="editor-primary">{saving ? "Salvataggio…" : "Salva ed esci"}</button></div></section></div>}
  </div>;
}

function ApiContractPreview({ batchId, inputSchema, outputSchema }: { batchId: string; inputSchema: ReturnType<typeof generateApiDefinition>["inputSchema"]; outputSchema: ReturnType<typeof makeOutputSchema> }) {
  const example = apiRequestExample(inputSchema, batchId, process.env.NEXT_PUBLIC_API_URL || "https://api.pdforchestrator.com");
  return <section className="mt-4 space-y-3">
    <div className="rounded-lg border border-[#263541] bg-[#0a1118] p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Esempio request JSON</h3>
      <p className="mt-1 text-[9px] text-slate-600">Sostituisci gli UUID di esempio con i fileId restituiti da POST /v1/uploads.</p>
      <pre className="mt-2 max-h-44 overflow-auto text-[9px] text-[#7597c9]">{example.json}</pre>
    </div>
    <div className="rounded-lg border border-[#263541] bg-[#0a1118] p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">cURL HMAC</h3>
      <p className="mt-1 text-[9px] text-slate-600">I valori PFO_* sono header firmati dal client. Il Secret non compare nel body.</p>
      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[9px] text-[#7597c9]">{example.curl}</pre>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-[#263541] bg-[#0a1118] p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Risposta HTTP 202</h3>
        <pre className="mt-2 overflow-auto text-[9px] text-[#7597c9]">{JSON.stringify(example.response, null, 2)}</pre>
      </div>
      <div className="rounded-lg border border-[#263541] bg-[#0a1118] p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Output completato</h3>
        <pre className="mt-2 max-h-44 overflow-auto text-[9px] text-[#7597c9]">{JSON.stringify(exampleExecutionOutput(), null, 2)}</pre>
      </div>
    </div>
    <details className="rounded-lg border border-[#263541] bg-[#0a1118] p-3">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-slate-400">Output JSON Schema</summary>
      <pre className="mt-2 max-h-44 overflow-auto text-[9px] text-[#7597c9]">{JSON.stringify(outputSchema, null, 2)}</pre>
    </details>
  </section>;
}

function parseApiDefault(value: string, type: ApiParameter["type"]): unknown {
  if (value === "") return undefined;
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "array" || type === "pdf-list" || type === "json") {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  return value;
}

function ContextVariablesEditor({ variables, onChange }: { variables: BatchVariable[]; onChange: (variables: BatchVariable[]) => void }) {
  const add = () => onChange([...variables, { name: `variabile_${variables.length + 1}`, type: "string" }]);
  return <div className="mt-5 border-t border-[#263541] pt-4"><div className="flex items-center justify-between"><div><h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Variabili di contesto</h3><p className="mt-1 text-[9px] text-slate-600">Persistite nel draft e disponibili nel picker.</p></div><button className="icon-btn" aria-label="Aggiungi variabile" onClick={add}><Plus size={14}/></button></div><div className="mt-2 space-y-2">{variables.map((variable, index) => <div key={index} className="grid grid-cols-[1fr_90px_1fr_auto] gap-1.5"><input aria-label="Nome variabile" value={variable.name} onChange={(event) => onChange(variables.map((item, i) => i === index ? { ...item, name: event.target.value.replace(/[^A-Za-z0-9_]/g, "") } : item))} className="min-w-0 rounded border border-[#293844] bg-[#111b25] px-2 py-1.5 font-mono text-[9px]"/><select aria-label="Tipo variabile" value={variable.type} onChange={(event) => onChange(variables.map((item, i) => i === index ? { ...item, type: event.target.value as BatchVariable["type"] } : item))} className="rounded border border-[#293844] bg-[#111b25] px-1 py-1.5 text-[9px]">{["string", "number", "boolean", "object", "array"].map((type) => <option key={type}>{type}</option>)}</select><input aria-label="Default variabile" value={variable.defaultValue === undefined ? "" : typeof variable.defaultValue === "string" ? variable.defaultValue : JSON.stringify(variable.defaultValue)} onChange={(event) => onChange(variables.map((item, i) => i === index ? { ...item, defaultValue: convertVariableValue(event.target.value, item.type) } : item))} placeholder="Default" className="min-w-0 rounded border border-[#293844] bg-[#111b25] px-2 py-1.5 text-[9px]"/><button className="text-slate-600 hover:text-red-300" aria-label={`Rimuovi ${variable.name}`} onClick={() => onChange(variables.filter((_, i) => i !== index))}><Trash2 size={12}/></button></div>)}</div>{variables.length === 0 && <p className="mt-2 text-[9px] text-slate-600">Nessuna variabile definita.</p>}</div>;
}

function convertVariableValue(value: string, type: BatchVariable["type"]): unknown {
  if (type === "number") return value === "" ? undefined : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "object" || type === "array") { try { return JSON.parse(value) as unknown; } catch { return value; } }
  return value;
}

function Ports({ title, ports }: { title: string; ports: BlockPort[] }) {
  return <div><p className="mb-2 text-[10px] text-slate-600">{title}</p>{ports.length ? ports.map((port) => <div key={port.id} className="mb-1.5 flex items-center justify-between rounded-md bg-[#121e28] px-2.5 py-2"><span className="text-[10px] text-slate-300">{port.label}{port.required && " *"}</span><span className="rounded bg-[#1a2638] px-1.5 py-0.5 font-mono text-[8px] text-[#7a9ccf]">{flowPort(port.type)}</span></div>) : <p className="text-[10px] text-slate-600">Nessuna porta</p>}</div>;
}

export function BatchEditor({ batchId, batch }: { batchId: string; batch: BatchInfo }) {
  return <ReactFlowProvider><Editor batchId={batchId} initialBatch={batch}/></ReactFlowProvider>;
}





