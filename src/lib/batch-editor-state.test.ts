import assert from "node:assert/strict";
import test from "node:test";
import { batchEditorSnapshotKey, hasUnsavedBatchEditorChanges, type BatchEditorSnapshot } from "@/lib/batch-editor-state";

const base: BatchEditorSnapshot = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  variables: [],
  parameters: [],
  batchName: "Batch demo",
};

test("batch editor snapshot is stable for identical persisted draft content", () => {
  assert.equal(batchEditorSnapshotKey(base), batchEditorSnapshotKey({ ...base }));
  const key = batchEditorSnapshotKey(base);
  assert.equal(hasUnsavedBatchEditorChanges(key, key), false);
  assert.equal(hasUnsavedBatchEditorChanges(null, key), false);
});

test("batch editor snapshot tracks title and viewport edits", () => {
  const key = batchEditorSnapshotKey(base);
  assert.notEqual(batchEditorSnapshotKey({ ...base, batchName: "Batch rinominato" }), key);
  assert.notEqual(batchEditorSnapshotKey({ ...base, viewport: { ...base.viewport, x: 25 } }), key);
  assert.equal(hasUnsavedBatchEditorChanges(key, batchEditorSnapshotKey({ ...base, batchName: "Batch rinominato" })), true);
});
