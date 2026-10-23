import assert from "node:assert/strict";
import test from "node:test";
import { blockRegistry, getBlockDefinition, latestBlockRegistry, toBlockDefinitionDto } from "@/lib/blocks/registry";
import { validateForEachConfiguration } from "@/lib/blocks/for-each";

test("registry exposes unique latest types, semantic versions and typed ports", () => {
  assert.equal(new Set(latestBlockRegistry.map((block) => block.type)).size, latestBlockRegistry.length);
  assert.ok(blockRegistry.some((block) => block.type === "pdf.merge" && block.version === "1.0.0"));
  assert.ok(blockRegistry.some((block) => block.type === "pdf.merge" && block.version === "1.1.0"));
  assert.ok(blockRegistry.some((block) => block.type === "pdf.merge" && block.version === "1.2.0"));
  for (const block of blockRegistry) {
    assert.match(block.version, /^\d+\.\d+\.\d+$/);
    assert.ok(block.worker.handlerId);
    assert.doesNotThrow(() => toBlockDefinitionDto(block));
  }
});

test("parameter defaults are Zod-validated and exact versions resolve", () => {
  const merge = getBlockDefinition("pdf.merge", "1.1.0");
  assert.ok(merge);
  assert.equal(merge.parametersSchema.safeParse({ mergePlan: { files: [{ filename: "a.pdf", position: 1 }] } }).success, true);
  assert.equal(merge.parametersSchema.safeParse({ mergePlan: { files: [{ filename: "a.pdf", position: 0 }] } }).success, false);
  assert.equal(getBlockDefinition("pdf.merge", "9.9.9"), null);
});

test("pdf.split 1.1 validates inclusive ranges, modes and safe PDF naming templates", () => {
  const split = getBlockDefinition("pdf.split", "1.1.0");
  assert.ok(split);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: [{ daPagina: 1, aPagina: 2 }, { daPagina: 3, aPagina: 3 }] }).success, true);
  assert.equal(split.parametersSchema.safeParse({ mode: "document", ranges: [{ daPagina: 1, aPagina: 2 }] }).success, true);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: [{ daPagina: 0, aPagina: 1 }] }).success, false);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: [{ daPagina: 2, aPagina: 1 }] }).success, false);
  assert.equal(split.parametersSchema.safeParse({ mode: "document", ranges: [{ daPagina: 1, aPagina: 2 }, { daPagina: 3, aPagina: 3 }] }).success, false);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: [{ daPagina: 1, aPagina: 1 }], filenameTemplate: "../{index}.pdf" }).success, false);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: [{ daPagina: 1, aPagina: 1 }], filenameTemplate: "{eval}.pdf" }).success, false);
  assert.equal(split.parametersSchema.safeParse({ mode: "documents", ranges: Array.from({ length: 101 }, () => ({ daPagina: 1, aPagina: 1 })) }).success, false);
  assert.deepEqual(split.outputs.filter((port) => ["pdf", "documents", "totalPages"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["documents", "documentList"], ["totalPages", "number"],
  ]);
  assert.equal(getBlockDefinition("pdf.split", "1.0.0")?.parametersSchema.safeParse({ ranges: ["1-2"] }).success, true);
});

test("pdf.output validates templates, collision policy and PDF artifact contract", () => {
  const output = getBlockDefinition("pdf.output", "1.0.0");
  assert.ok(output);
  assert.equal(output.worker.worker, "orchestrator");
  assert.equal(output.parametersSchema.safeParse({}).success, true);
  assert.equal(output.parametersSchema.safeParse({ filenameTemplate: "{basename}-{nodeId}-{index}.pdf", collisionPolicy: "rename", contentType: "application/pdf" }).success, true);
  assert.equal(output.parametersSchema.safeParse({ filenameTemplate: "../{basename}.pdf" }).success, false);
  assert.equal(output.parametersSchema.safeParse({ filenameTemplate: "{unknown}.pdf" }).success, false);
  assert.equal(output.parametersSchema.safeParse({ collisionPolicy: "append" }).success, false);
  assert.equal(output.parametersSchema.safeParse({ contentType: "text/html" }).success, false);
  assert.deepEqual(output.outputs.filter((port) => ["artifact", "manifest"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["artifact", "object"], ["manifest", "object"],
  ]);
});

test("pdf.merge 1.2 validates file references, names, ordering, and exposes page provenance", () => {
  const merge = getBlockDefinition("pdf.merge", "1.2.0");
  assert.ok(merge);
  assert.equal(merge.parametersSchema.safeParse({ files: [
    { fileRef: "upload-a", filename: "a.pdf", order: 2 },
    { fileRef: "upload-b", filename: "b.pdf", order: 1 },
  ] }).success, true);
  assert.equal(merge.parametersSchema.safeParse({ files: [
    { fileRef: "same", filename: "a.pdf", order: 1 }, { fileRef: "same", filename: "b.pdf", order: 1 },
  ] }).success, false);
  assert.deepEqual(merge.outputs.filter((port) => ["pdf", "totalPages", "pageMap"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["totalPages", "number"], ["pageMap", "array"],
  ]);
});

test("condition group declares boolean output and control branches", () => {
  const block = getBlockDefinition("logic.conditionGroup", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "logic.conditionGroup");
  assert.ok(block.requiredParameters.includes("condition"));
  assert.deepEqual(block.outputs.filter((port) => ["boolean", "true", "false"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["boolean", "boolean"], ["true", "control"], ["false", "control"],
  ]);
});

test("each-page loop declares bounded iteration settings, scope values and both control branches", () => {
  const block = getBlockDefinition("loop.eachPage", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "loop.eachPage");
  assert.equal(block.parametersSchema.safeParse({ start: 1, step: 1, maxIterations: 1000 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ start: 0, step: 0, maxIterations: 1001 }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["document", "currentPage", "pageId", "pageCount", "index", "body", "after"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["document", "document"], ["currentPage", "number"], ["pageId", "string"], ["pageCount", "number"], ["index", "number"], ["body", "control"], ["after", "control"],
  ]);
});

test("delete-pages 1.1 exposes deferred current-page deletion while 1.0 remains immutable", () => {
  const legacy = getBlockDefinition("pdf.delete-pages", "1.0.0");
  const current = getBlockDefinition("pdf.delete-pages", "1.1.0");
  assert.ok(legacy); assert.ok(current);
  assert.equal(legacy.parametersSchema.safeParse({ pages: [1] }).success, true);
  assert.equal(legacy.parametersSchema.safeParse({ deleteCurrentPage: true }).success, false);
  assert.equal(current.parametersSchema.safeParse({ deleteCurrentPage: true }).success, true);
  assert.equal(current.parametersSchema.safeParse({ pages: [1], deleteCurrentPage: false }).success, true);
});

test("forEach declares an array source, typed columns, bounded iterations and body/after controls", () => {
  const block = getBlockDefinition("loop.forEach", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "loop.forEach");
  assert.equal(block.parametersSchema.safeParse({ source: { source: "api", name: "rows" }, itemType: "object", columns: [{ name: "text", type: "string" }], maxIterations: 100 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ source: { source: "api", name: "rows" }, maxIterations: 1001 }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["items", "count", "body", "after"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["items", "array"], ["count", "number"], ["body", "control"], ["after", "control"],
  ]);
});

test("forEach v1.1 bridges a documentList to a current PDF, collected PDFs and iteration results", () => {
  const legacy = getBlockDefinition("loop.forEach", "1.0.0");
  const current = getBlockDefinition("loop.forEach", "1.1.0");
  assert.ok(legacy); assert.ok(current);
  assert.equal(legacy.outputs.some((port) => port.id === "document"), false);
  assert.deepEqual(current.outputs.filter((port) => ["document", "documents", "results"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["document", "document"], ["documents", "documentList"], ["results", "array"],
  ]);
  assert.equal(current.parametersSchema.safeParse({ source: { source: "node", nodeId: "files", port: "pdfs" }, itemType: "document", maxIterations: 10 }).success, true);
  assert.deepEqual(validateForEachConfiguration({ source: { source: "node", nodeId: "files", port: "pdfs" }, itemType: "document", filter: { column: "filename", operator: "contains", value: ".pdf" } }, true), ["I PDF non supportano il filtro per colonna di loop.forEach."]);
});

test("forEach v1.2 has a directly connectable optional documentList input", () => {
  const connected = getBlockDefinition("loop.forEach", "1.2.0");
  assert.ok(connected);
  assert.ok(connected.inputs.some((port) => port.id === "pdfs" && port.type === "documentList" && !port.required));
  assert.equal(connected.parametersSchema.safeParse({ itemType: "document", maxIterations: 10 }).success, true);
  assert.equal(connected.parametersSchema.safeParse({ itemType: "object", maxIterations: 10 }).success, false);
  assert.equal(connected.parametersSchema.safeParse({ itemType: "object", source: { source: "api", name: "rows" }, maxIterations: 10 }).success, true);
});

test("lookup and variable blocks expose typed, validated contracts", () => {
  const lookup = getBlockDefinition("data.lookup", "1.0.0");
  const setter = getBlockDefinition("data.setVariable", "1.0.0");
  assert.ok(lookup); assert.ok(setter);
  assert.deepEqual(lookup.inputs.map((port) => [port.id, port.type]), [["run", "control"], ["items", "array"], ["record", "object"]]);
  assert.ok(lookup.outputs.some((port) => port.id === "found" && port.type === "control"));
  assert.ok(lookup.outputs.some((port) => port.id === "notFound" && port.type === "control"));
  assert.equal(lookup.parametersSchema.safeParse({ column: "text", valueType: "string", operator: "contains", value: "invoice" }).success, true);
  assert.equal(lookup.parametersSchema.safeParse({ column: "score", valueType: "number", operator: "range", min: 8, max: 2 }).success, false);
  assert.equal(setter.parametersSchema.safeParse({ name: "count", scope: "loop", valueType: "number", value: 2 }).success, true);
  assert.equal(setter.parametersSchema.safeParse({ name: "__proto__", scope: "workflow", valueType: "number", value: 2 }).success, false);
});

test("WHILE and REPEAT UNTIL require bounded iterations and declare body/after controls", () => {
  const condition = { kind: "comparison", leftType: "number", rightType: "number", left: 0, right: 2, operator: "lt" };
  for (const type of ["loop.while", "loop.repeatUntil"]) {
    const block = getBlockDefinition(type, "1.0.0"); assert.ok(block);
    assert.equal(block.parametersSchema.safeParse({ condition, maxIterations: 10 }).success, true);
    assert.equal(block.parametersSchema.safeParse({ condition }).success, false);
    assert.equal(block.parametersSchema.safeParse({ condition, maxIterations: 1001 }).success, false);
    assert.deepEqual(block.outputs.filter((port) => ["iteration", "body", "after"].includes(port.id)).map(({ id, type: portType }) => [id, portType]), [
      ["iteration", "number"], ["body", "control"], ["after", "control"],
    ]);
  }
});

test("break, continue and jump-page blocks declare structured control transfers", () => {
  for (const type of ["flow.break", "flow.continue"]) {
    const block = getBlockDefinition(type, "1.0.0"); assert.ok(block);
    assert.equal(block.worker.worker, "orchestrator");
    assert.ok(block.outputs.some((port) => port.type === "control"));
    assert.equal(block.parametersSchema.safeParse({}).success, true);
  }
  const jump = getBlockDefinition("flow.jumpPage", "1.0.0"); assert.ok(jump);
  assert.equal(jump.parametersSchema.safeParse({ targetMode: "relative", value: -2 }).success, true);
  assert.deepEqual(jump.parametersSchema.safeParse({ targetMode: "relative", value: 0 }).success, true);
  assert.deepEqual(jump.parametersSchema.safeParse({ targetMode: "absolute", value: 0 }).success, true);
});

test("pdf.qr.readAll declares a bounded scan range, concurrency and progress output", () => {
  const block = getBlockDefinition("pdf.qr.readAll", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.qr.readAll");
  assert.deepEqual(block.outputs.filter((port) => ["codes", "pagesScanned"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["codes", "array"], ["pagesScanned", "number"],
  ]);
  assert.equal(block.worker.timeoutSeconds, 900);
  assert.equal(block.parametersSchema.safeParse({}).success, true);
  assert.equal(block.parametersSchema.safeParse({ startPage: 4, endPage: 2 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ startPage: 1, endPage: 3, dpi: 72, concurrency: 8 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ concurrency: 9 }).success, false);
});

test("pdf.qr.readPage declares a bounded single-page scanner contract", () => {
  const block = getBlockDefinition("pdf.qr.readPage", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.qr.readPage");
  assert.deepEqual(block.outputs.filter((port) => ["codes", "found", "count"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["codes", "array"], ["found", "boolean"], ["count", "number"],
  ]);
  assert.equal(block.parametersSchema.safeParse({ page: 1 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ page: 0 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ page: 1, dpi: 72, preprocess: "grayscale" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ page: 1, dpi: 601 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ page: 1, preprocess: "arbitrary" }).success, false);
});

test("pdf.bookmark.add declares a bounded page, Unicode title, hierarchy and PDF output", () => {
  const block = getBlockDefinition("pdf.bookmark.add", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.bookmark.add");
  assert.deepEqual(block.outputs.find((port) => port.id === "pdf")?.type, "document");
  assert.equal(block.parametersSchema.safeParse({ page: 1, description: "Capitolo Ω", level: 0 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ page: 1, description: "Sottosezione", level: 1, parent: "Capitolo Ω" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ page: 0, description: "Titolo" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ page: 1, description: "  " }).success, false);
  assert.equal(block.parametersSchema.safeParse({ page: 1, description: "Titolo", level: 9 }).success, false);
});

test("pdf.page.delete accepts one page selector and exposes stable deletion results", () => {
  const block = getBlockDefinition("pdf.page.delete", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.page.delete");
  assert.equal(block.parametersSchema.safeParse({ page: 2 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ pages: [3, 1, 3] }).success, true);
  assert.equal(block.parametersSchema.safeParse({ pageId: "0123456789abcdef:page:2" }).success, true);
  assert.equal(block.parametersSchema.safeParse({}).success, false);
  assert.equal(block.parametersSchema.safeParse({ page: 1, pages: [2] }).success, false);
  assert.equal(block.parametersSchema.safeParse({ pageId: "not-stable" }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["pdf", "deletedPages", "deletedPageIds"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["deletedPages", "array"], ["deletedPageIds", "array"],
  ]);
});

test("pdf.page.normalize declares ISO defaults, scopes, anchors, modes and result reasons", () => {
  const block = getBlockDefinition("pdf.page.normalize", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.page.normalize");
  assert.equal(block.worker.timeoutSeconds, 300);
  assert.deepEqual(block.parametersSchema.safeParse({}).data, {
    size: "A4", orientation: "auto", tolerancePercent: 2, mode: "EXPAND_CANVAS", anchor: "CENTER", pageScope: "ALL",
  });
  assert.equal(block.parametersSchema.safeParse({ size: "A6", orientation: "landscape", tolerancePercent: 0, mode: "SCALE_CONTENT", anchor: "BOTTOM_RIGHT" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ size: "LETTER" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ tolerancePercent: 10.1 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "RANGE", fromPage: 2, toPage: 4 }).success, true);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "RANGE", fromPage: 4, toPage: 2 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "RANGE", fromPage: 2 }).success, false);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "SELECTED", pages: [1, 3] }).success, true);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "SELECTED", pages: [1, 1] }).success, false);
  assert.equal(block.parametersSchema.safeParse({ pageScope: "ALL", pages: [1] }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["pdf", "modifiedPages", "skippedPages", "reason"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["modifiedPages", "array"], ["skippedPages", "array"], ["reason", "object"],
  ]);
});

test("pdf.page.insert validates bounded source pages and declares document provenance", () => {
  const block = getBlockDefinition("pdf.page.insert", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.page.insert");
  assert.deepEqual(block.inputs.filter((port) => ["pdf", "sources"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["sources", "documentList"],
  ]);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: [1, 3], targetPage: 2, position: "before" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: [], targetPage: 2, position: "before" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: [1, 1], targetPage: 2, position: "after" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: Array.from({ length: 1001 }, (_, index) => index + 1), targetPage: 2, position: "after" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: [1], targetPage: 0, position: "after" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ sourceFile: "upload-a", sourcePages: [1], targetPage: 2, position: "goto" }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["pdf", "insertedCount", "pageMap"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["insertedCount", "number"], ["pageMap", "array"],
  ]);
});

test("QR matching block requires typed JSON records and API named output requires a PDF filename", () => {
  const matcher = getBlockDefinition("pdf.qr.removeMatchedPages", "1.0.0");
  const output = getBlockDefinition("pdf.output.apiName", "1.0.0");
  assert.ok(matcher && output);
  assert.equal(matcher.worker.handlerId, "pdf.qr.removeMatchedPages");
  assert.equal(matcher.parametersSchema.safeParse({ records: [{ testoQR: "Q-1", nomeQR: "Documento 1" }] }).success, true);
  assert.equal(matcher.parametersSchema.safeParse({ records: [{ testoQR: "Q-1", nomeQR: "  " }] }).success, false);
  assert.equal(output.parametersSchema.safeParse({ filename: "Finale.pdf" }).success, true);
  assert.equal(output.parametersSchema.safeParse({ filename: "../Finale.pdf" }).success, false);
  assert.equal(output.parametersSchema.safeParse({}).success, false);
});

test("PDF/A converter exposes a target and API-bindable input/output verification flags", () => {
  const block = getBlockDefinition("pdf.convert.pdfa", "1.0.0");
  assert.ok(block);
  assert.equal(block.worker.handlerId, "pdf.convert.pdfa");
  assert.equal(block.worker.timeoutSeconds, 600);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-1b" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-2b" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-3b" }).success, true);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-2b", verifyInput: true, verifyOutput: false }).success, true);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-2b", verifyInput: "true" }).success, false);
  const defaults = block.parametersSchema.parse({}) as { verifyInput: boolean; verifyOutput: boolean };
  assert.equal(defaults.verifyInput, false);
  assert.equal(defaults.verifyOutput, true);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-2u" }).success, false);
  assert.equal(block.parametersSchema.safeParse({ target: "PDF/A-2a" }).success, false);
  assert.deepEqual(block.outputs.filter((port) => ["pdf", "validationReport"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["validationReport", "object"],
  ]);
});

test("PDF to TIFF converter and output blocks expose typed, bounded TIFF contracts", () => {
  const convert = getBlockDefinition("pdf.convert.tiff", "1.0.0");
  const pageOutput = getBlockDefinition("output.tiff.pages", "1.0.0");
  const multipageOutput = getBlockDefinition("output.tiff.multipage", "1.0.0");
  assert.ok(convert && pageOutput && multipageOutput);
  assert.equal(convert.worker.worker, "python");
  assert.equal(convert.parametersSchema.safeParse({ dpi: 300, compression: "tiff_lzw" }).success, true);
  assert.equal(convert.parametersSchema.safeParse({ dpi: 71 }).success, false);
  assert.equal(convert.parametersSchema.safeParse({ dpi: 1201 }).success, false);
  assert.equal(convert.parametersSchema.safeParse({ dpi: 300, compression: "jpeg" }).success, false);
  assert.deepEqual(convert.outputs.filter((port) => ["pages", "multipage", "pageCount", "sourceResolution"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pages", "documentList"], ["multipage", "document"], ["pageCount", "number"], ["sourceResolution", "object"],
  ]);
  assert.equal(pageOutput.inputs.find((port) => port.id === "pages")?.type, "documentList");
  assert.equal(multipageOutput.inputs.find((port) => port.id === "tiff")?.type, "document");
  assert.equal(multipageOutput.parametersSchema.safeParse({ filename: "risultato.tiff" }).success, true);
  assert.equal(multipageOutput.parametersSchema.safeParse({ filename: "../risultato.tiff" }).success, false);
});

test("single-page TIFF conversion and multipage TIFF assembly expose API-ready contracts", () => {
  const convert = getBlockDefinition("pdf.convert.tiff.pages", "1.0.0");
  const create = getBlockDefinition("output.tiff.createMultipage", "1.0.0");
  assert.ok(convert && create);
  assert.equal(convert.worker.worker, "python");
  assert.equal(convert.outputs.find((port) => port.id === "pages")?.type, "documentList");
  assert.equal(convert.parametersSchema.safeParse({ dpi: 300, compression: "tiff_lzw" }).success, true);
  assert.equal(convert.parametersSchema.safeParse({ dpi: 300, compression: "jpeg", quality: 85 }).success, true);
  assert.equal(convert.parametersSchema.safeParse({ dpi: 300, compression: "jpeg", quality: 101 }).success, false);
  assert.equal(convert.parametersSchema.safeParse({ colorMode: "YCbCr" }).success, true);
  assert.equal(convert.parametersSchema.safeParse({ colorMode: "grayscale" }).success, true);
  assert.equal(convert.parametersSchema.safeParse({ colorMode: "unsupported" }).success, false);
  assert.equal(convert.outputs.find((port) => port.id === "colorMode")?.type, "string");
  assert.equal(create.worker.worker, "orchestrator");
  assert.equal(create.inputs.find((port) => port.id === "pages")?.type, "documentList");
  assert.equal(create.inputs.find((port) => port.id === "tiffs")?.multiple, true);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff" }).success, true);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", compression: "jpeg", quality: 85 }).success, true);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", compression: "jpeg", quality: 101 }).success, false);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", colorMode: "CMYK" }).success, true);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", colorMode: "unsupported" }).success, false);
  assert.equal(create.outputs.find((port) => port.id === "colorMode")?.type, "string");
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", fromIndex: 0, toIndex: 0 }).success, true);
  assert.equal(create.parametersSchema.safeParse({ filename: "estratto.tiff", fromIndex: 3, toIndex: 2 }).success, false);
  assert.equal(create.parametersSchema.safeParse({ filename: "../estratto.tiff" }).success, false);
});

test("pdf.ocr 1.1 validates page range, languages, DPI and optional outputs without changing v1.0", () => {
  const legacy = getBlockDefinition("pdf.ocr", "1.0.0");
  const ocr = getBlockDefinition("pdf.ocr", "1.1.0");
  assert.ok(legacy); assert.ok(ocr);
  assert.ok(blockRegistry.some((block) => block.type === "pdf.ocr" && block.version === "1.0.0"));
  assert.ok(blockRegistry.some((block) => block.type === "pdf.ocr" && block.version === "1.1.0"));
  assert.equal(legacy.parametersSchema.safeParse({ languages: ["ita"], searchablePdf: true }).success, true);
  assert.equal(ocr.worker.handlerId, "pdf.ocr");
  assert.equal(ocr.worker.timeoutSeconds, 900);
  assert.equal(ocr.parametersSchema.safeParse({}).success, true);
  assert.equal(ocr.parametersSchema.safeParse({ from: 2, to: 4, languages: ["ita", "eng"], dpi: 300, skipExistingText: true, searchableOverlay: true, includeExtractedText: true }).success, true);
  assert.equal(ocr.parametersSchema.safeParse({ from: 0 }).success, false);
  assert.equal(ocr.parametersSchema.safeParse({ from: 4, to: 3 }).success, false);
  assert.equal(ocr.parametersSchema.safeParse({ dpi: 601 }).success, false);
  assert.equal(ocr.parametersSchema.safeParse({ languages: ["ita; arbitrary"] }).success, false);
  assert.equal(ocr.parametersSchema.safeParse({ languages: Array.from({ length: 9 }, () => "eng") }).success, false);
  assert.equal(ocr.parametersSchema.safeParse({ skipExistingText: "yes" }).success, false);
  assert.deepEqual(ocr.outputs.filter((port) => ["pdf", "extractedText"].includes(port.id)).map(({ id, type }) => [id, type]), [
    ["pdf", "document"], ["extractedText", "string"],
  ]);
});
