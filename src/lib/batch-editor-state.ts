import { generateApiDefinition, makeOutputSchema } from "@/lib/api-schema";
import { serializeGraph, type ApiParameter, type BatchEdge, type BatchNode, type BatchVariable, type BatchViewport } from "@/lib/batch-graph";

export type BatchEditorSnapshot = {
  nodes: BatchNode[];
  edges: BatchEdge[];
  viewport: BatchViewport;
  variables: BatchVariable[];
  parameters: ApiParameter[];
  batchName: string;
};

export function batchEditorSnapshotKey(state: BatchEditorSnapshot): string {
  const contract = generateApiDefinition(state.nodes, state.parameters);
  return JSON.stringify({
    graph: serializeGraph(state.nodes, state.edges, state.viewport, state.variables),
    inputSchema: contract.inputSchema,
    outputSchema: makeOutputSchema(),
    batchName: state.batchName,
  });
}

export function hasUnsavedBatchEditorChanges(savedKey: string | null, currentKey: string): boolean {
  return savedKey !== null && savedKey !== currentKey;
}
