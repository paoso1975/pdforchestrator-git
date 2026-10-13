import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionLog, executionLogPlainText } from "@/lib/execution-log";

test("builds a timestamped log from persisted run, event, and step data", () => {
  const entries = buildExecutionLog({
    id: "run-1", status: "RUNNING", createdAt: "2026-10-13T10:00:00Z", input: { fileId: "f-1" },
    batch: { name: "Batch test" }, batchVersion: { version: 3, graph: { nodes: [{ id: "node-1", data: { label: "Leggi QR", toolId: "pdf.qr.readAll" } }] } },
    events: [{ id: "event-1", type: "STEP_UPDATE", createdAt: "2026-10-13T10:00:02Z", payload: { nodeId: "node-1", toolId: "pdf.qr.readAll", toolVersion: "1.0.0", status: "SUCCEEDED", input: { page: 1 }, output: { codes: [{ value: "abc" }] } } }],
    steps: [],
  });
  assert.equal(entries[0]?.heading, "Avvio job");
  assert.ok(entries.some((entry) => entry.heading.includes("Leggi QR") && entry.details.some((detail) => detail.label === "Input blocco")));
  assert.match(executionLogPlainText(entries), /2026-10-13T10:00:00.000Z/);
});

test("uses saved step fields as a readable fallback for older executions", () => {
  const entries = buildExecutionLog({
    id: "run-2", status: "FAILED", createdAt: "2026-10-13T10:00:00Z", error: { message: "errore" },
    steps: [{ nodeId: "n1", toolId: "pdf.output", status: "FAILED", error: { code: "E_OUTPUT" }, completedAt: "2026-10-13T10:00:03Z" }],
  }, { nodes: [{ id: "n1", data: { label: "Output file" } }] });
  assert.ok(entries.some((entry) => entry.heading.includes("Output file") && entry.state === "FAILED"));
  assert.ok(entries.some((entry) => entry.heading === "Errore del job"));
});

test("shows API provenance and detailed block parameters and variable snapshots", () => {
  const log = buildExecutionLog({
    id: "run-audit", status: "RUNNING", origin: "API_CREDENTIAL", requestId: "req-audit",
    requestMethod: "POST", requestPath: "/api/public/v1/batches/test/runs", executionString: "POST /api/public/v1/batches/test/runs",
    input: { document: "file-1" }, steps: [], events: [{ id: "event-audit", type: "STEP_COMPLETED", createdAt: "2026-10-13T10:00:00Z", payload: {
      nodeId: "node-1", toolId: "data.setVariable", toolVersion: "1.0.0", status: "SUCCEEDED", parameters: { name: "qrName", value: "A1" },
      variablesIn: { workflow: {} }, variablesOut: { workflow: { qrName: "A1" } }, executionString: "data.setVariable A1",
    } }],
  });
  assert.ok(log[0].details.some((detail) => detail.label === "Provenienza" && detail.value === "API_CREDENTIAL"));
  const step = log.find((entry) => entry.id === "event:event-audit");
  assert.ok(step?.details.some((detail) => detail.label === "Parametri risolti"));
  assert.ok(step?.details.some((detail) => detail.label === "Variabili in uscita (workflow/loop)"));
  assert.ok(step?.details.some((detail) => detail.label === "Stringa di esecuzione"));
});
