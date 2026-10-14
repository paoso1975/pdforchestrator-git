import { FileInput, FileOutput, FileText, GitBranch, Layers3, Repeat2, ScanLine, type LucideIcon } from "lucide-react";
import { z } from "zod";
import { toolDefinitionSchema } from "@/lib/schemas/api";
import { logicIfParametersSchema } from "@/lib/blocks/logic-if";
import { conditionGroupParametersSchema } from "@/lib/blocks/condition-group";
import { forEachDocumentParametersSchema, forEachParametersSchema } from "@/lib/blocks/for-each";
import { conditionalLoopParametersSchema } from "@/lib/blocks/conditional-loop";
import { emptyFlowParametersSchema, jumpPageParametersSchema } from "@/lib/blocks/flow-transfers";
import { lookupParametersSchema, setVariableParametersSchema } from "@/lib/blocks/data-operations";

export const portTypes = ["control", "document", "documentList", "string", "number", "boolean", "object", "array"] as const;
export type BlockPortType = typeof portTypes[number];
export type BlockCategory = "input" | "output" | "pages" | "analysis" | "metadata" | "flow" | "loop";

export type BlockPort = { id: string; label: string; type: BlockPortType; required?: boolean; multiple?: boolean };
export type WorkerCapability = { worker: "python" | "orchestrator"; handlerId: string; timeoutSeconds: number; resourceClass: "small" | "standard" | "large" };
export type BlockDefinition = {
  type: string;
  version: string;
  category: BlockCategory;
  icon: LucideIcon;
  iconName: string;
  color: { accent: string; surface: string; border: string };
  label: string;
  description: string;
  inputs: BlockPort[];
  outputs: BlockPort[];
  parametersSchema: z.ZodType;
  requiredParameters: readonly string[];
  defaults: Record<string, unknown>;
  worker: WorkerCapability;
  enabled: boolean;
};

const jsonValue = z.json();
const pageNumbers = z.array(z.number().int().positive()).min(1);
const pageDeleteParametersSchema = z.object({
  page: z.number().int().positive().optional(),
  pages: z.array(z.number().int().positive()).min(1).max(1000).optional(),
  pageId: z.string().regex(/^[a-f0-9]{16}:page:[1-9][0-9]*$/).optional(),
}).strict().superRefine((value, ctx) => {
  const selected = [value.page !== undefined, value.pages !== undefined, value.pageId !== undefined].filter(Boolean).length;
  if (selected !== 1) ctx.addIssue({ code: "custom", message: "Specificare esattamente uno tra page, pages e pageId." });
});
const stringList = z.array(z.string().min(1));
const pageEntry = z.object({ currentPage: z.number().int().positive(), outputPosition: z.number().int().positive() }).strict();
const mergeEntry = z.object({ filename: z.string().trim().min(1), position: z.number().int().positive() }).strict();
const mergePlanEntry = z.object({ fileRef: z.string().trim().min(1).max(256), filename: z.string().trim().min(1).max(255), order: z.number().int().positive() }).strict();
const bookmark = z.object({ id: z.string().optional(), title: z.string().min(1), page: z.number().int().positive(), parent: z.string().optional() }).strict();
const pageNormalizeAnchors = ["TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "CENTER_LEFT", "CENTER", "CENTER_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT"] as const;
const pageNormalizeParametersSchema = z.object({
  size: z.enum(["A3", "A4", "A5", "A6"]).default("A4"),
  orientation: z.enum(["auto", "portrait", "landscape"]).default("auto"),
  tolerancePercent: z.number().min(0).max(10).default(2),
  mode: z.enum(["EXPAND_CANVAS", "SCALE_CONTENT"]).default("EXPAND_CANVAS"),
  anchor: z.enum(pageNormalizeAnchors).default("CENTER"),
  pageScope: z.enum(["ALL", "RANGE", "SELECTED"]).default("ALL"),
  fromPage: z.number().int().positive().optional(),
  toPage: z.number().int().positive().optional(),
  pages: z.array(z.number().int().positive()).min(1).max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.pageScope === "RANGE") {
    if (value.fromPage === undefined || value.toPage === undefined) ctx.addIssue({ code: "custom", path: ["fromPage"], message: "Un intervallo richiede fromPage e toPage." });
    if (value.fromPage !== undefined && value.toPage !== undefined && value.toPage < value.fromPage) ctx.addIssue({ code: "custom", path: ["toPage"], message: "toPage deve essere maggiore o uguale a fromPage." });
  } else if (value.fromPage !== undefined || value.toPage !== undefined) {
    ctx.addIssue({ code: "custom", path: ["pageScope"], message: "fromPage e toPage sono ammessi solo con pageScope RANGE." });
  }
  if (value.pageScope === "SELECTED" && value.pages === undefined) ctx.addIssue({ code: "custom", path: ["pages"], message: "La selezione richiede almeno una pagina." });
  if (value.pageScope !== "SELECTED" && value.pages !== undefined) ctx.addIssue({ code: "custom", path: ["pages"], message: "pages è ammesso solo con pageScope SELECTED." });
  if (value.pages && new Set(value.pages).size !== value.pages.length) ctx.addIssue({ code: "custom", path: ["pages"], message: "Le pagine selezionate non possono contenere duplicati." });
});

const colors: Record<BlockCategory, BlockDefinition["color"]> = {
  input: { accent: "#93bcff", surface: "#122849", border: "#2459a6" },
  output: { accent: "#77aaff", surface: "#10213d", border: "#1e4f9a" },
  pages: { accent: "#5b91f4", surface: "#132b4e", border: "#285faf" },
  analysis: { accent: "#a5c5ff", surface: "#1a3154", border: "#4a71b3" },
  metadata: { accent: "#84b1ff", surface: "#172a49", border: "#3868ad" },
  flow: { accent: "#b8d1ff", surface: "#1a2f50", border: "#5279b6" },
  loop: { accent: "#8fb8ff", surface: "#182d4d", border: "#3a68ab" },
};
const icons: Record<BlockCategory, { component: LucideIcon; name: string }> = {
  input: { component: FileInput, name: "FileInput" },
  output: { component: FileOutput, name: "FileOutput" },
  pages: { component: Layers3, name: "Layers3" },
  analysis: { component: ScanLine, name: "ScanLine" },
  metadata: { component: FileText, name: "FileText" },
  flow: { component: GitBranch, name: "GitBranch" },
  loop: { component: Repeat2, name: "Repeat2" },
};

function p(id: string, type: BlockPortType, required = false, multiple = false): BlockPort {
  return { id, label: id, type, ...(required ? { required: true } : {}), ...(multiple ? { multiple: true } : {}) };
}

function defineBlock(input: Omit<BlockDefinition, "icon" | "iconName" | "color" | "requiredParameters">): BlockDefinition {
  const icon = icons[input.category];
  const jsonSchema = z.toJSONSchema(input.parametersSchema, { target: "draft-7" }) as { required?: string[] };
  const inputs = input.category === "input" ? input.inputs : [p("run", "control", false, true), ...input.inputs];
  const outputs = [...input.outputs, p("success", "control", false, true), p("error", "control", false, true)];
  return { ...input, inputs, outputs, requiredParameters: jsonSchema.required ?? [], icon: icon.component, iconName: icon.name, color: colors[input.category] };
}

const defs: BlockDefinition[] = [
  defineBlock({ type: "input.pdf", version: "1.0.0", category: "input", label: "Input PDF", description: "Accetta un singolo PDF caricato.", inputs: [], outputs: [p("pdf", "document")], parametersSchema: z.object({ parameter: z.string().min(1).default("documento") }).strict(), defaults: { parameter: "documento" }, worker: { worker: "orchestrator", handlerId: "input.pdf", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "input.pdf-list", version: "1.0.0", category: "input", label: "Input multiplo PDF", description: "Accetta una lista ordinata di PDF caricati.", inputs: [], outputs: [p("pdfs", "documentList")], parametersSchema: z.object({ parameter: z.string().min(1).default("documenti") }).strict(), defaults: { parameter: "documenti" }, worker: { worker: "orchestrator", handlerId: "input.pdf-list", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "output.pdf", version: "1.0.0", category: "output", label: "Output PDF", description: "Seleziona e archivia il PDF prodotto.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ filename: z.string().min(1).default("output.pdf") }).strict(), defaults: { filename: "output.pdf" }, worker: { worker: "orchestrator", handlerId: "output.pdf", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "output.pdf", version: "1.1.0", category: "output", label: "Output PDF multiplo", description: "Archivia un PDF oppure tutti i documenti prodotti da Dividi PDF.", inputs: [p("pdf", "document"), p("documents", "documentList")], outputs: [p("pdf", "document"), p("documents", "documentList")], parametersSchema: z.object({ filename: z.string().min(1).max(255).default("output.pdf") }).strict(), defaults: { filename: "output.pdf" }, worker: { worker: "orchestrator", handlerId: "output.pdf", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "pdf.output.apiName", version: "1.0.0", category: "output", label: "Output PDF con nome API", description: "Registra il PDF come artifact usando il nome obbligatorio ricevuto dalla chiamata API.", inputs: [p("document", "document", true)], outputs: [p("artifact", "object"), p("manifest", "object")], parametersSchema: z.object({ filename: z.string().trim().min(1).max(255).regex(/^[^/\\]+\.pdf$/i).refine((value) => !value.includes(".."), "Il nome file non può contenere '..'.") }).strict(), defaults: {}, worker: { worker: "orchestrator", handlerId: "pdf.output", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "pdf.output", version: "1.0.0", category: "output", label: "Output file PDF", description: "Registra il PDF come artifact del job, con nome sicuro e manifest scaricabile tramite URL firmato.", inputs: [p("document", "document", true)], outputs: [p("artifact", "object"), p("manifest", "object")], parametersSchema: z.object({ filenameTemplate: z.string().trim().min(1).max(200).default("{basename}.pdf"), collisionPolicy: z.enum(["error", "rename", "overwrite"]).default("rename"), contentType: z.literal("application/pdf").default("application/pdf") }).strict().superRefine((value, ctx) => {
    const template = value.filenameTemplate;
    if (template.includes("/") || template.includes("\\") || template.includes("..") || !template.toLowerCase().endsWith(".pdf")) ctx.addIssue({ code: "custom", path: ["filenameTemplate"], message: "Il modello deve essere un nome file PDF, senza percorsi o segmenti '..'." });
    const placeholders = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    if (placeholders.some((name) => !["basename", "nodeId", "index"].includes(name)) || /\{[^{}]*\}/.test(template.replace(/\{(?:basename|nodeId|index)\}/g, ""))) ctx.addIssue({ code: "custom", path: ["filenameTemplate"], message: "Placeholder ammessi: {basename}, {nodeId}, {index}." });
  }), defaults: { filenameTemplate: "{basename}.pdf", collisionPolicy: "rename", contentType: "application/pdf" }, worker: { worker: "orchestrator", handlerId: "pdf.output", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "pdf.merge", version: "1.0.0", category: "pages", label: "Unisci PDF", description: "Unisce PDF nell'ordine dei collegamenti (versione legacy).", inputs: [p("pdfs", "documentList", true, true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ bookmark: z.boolean().default(true) }).strict(), defaults: { bookmark: true }, worker: { worker: "python", handlerId: "pdf.merge", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.merge", version: "1.1.0", category: "pages", label: "Unisci PDF", description: "Unisce i PDF secondo il JSON con nomi file e posizione.", inputs: [p("pdfs", "documentList", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ mergePlan: z.object({ files: z.array(mergeEntry).min(1) }).strict() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.merge", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.merge", version: "1.2.0", category: "pages", label: "Unisci PDF", description: "Unisce file PDF identificati da fileRef con ordinamento stabile e restituisce il mapping delle pagine origine/destinazione.", inputs: [p("pdfs", "documentList", true)], outputs: [p("pdf", "document"), p("totalPages", "number"), p("pageMap", "array")], parametersSchema: z.object({ files: z.array(mergePlanEntry).min(1).max(100) }).strict().superRefine((value, ctx) => {
    const refs = value.files.map((item) => item.fileRef);
    if (new Set(refs).size !== refs.length) ctx.addIssue({ code: "custom", path: ["files"], message: "Ogni fileRef può comparire una sola volta." });
  }), defaults: {}, worker: { worker: "python", handlerId: "pdf.merge", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.split", version: "1.0.0", category: "pages", label: "Dividi PDF", description: "Divide un PDF in intervalli o singole pagine.", inputs: [p("pdf", "document", true)], outputs: [p("pdfs", "documentList")], parametersSchema: z.object({ ranges: stringList.min(1) }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.split", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.split", version: "1.1.0", category: "pages", label: "Dividi PDF", description: "Estrae intervalli inclusivi 1-based. Ogni intervallo crea un documento oppure tutti gli intervalli vengono raccolti in un unico documento.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("documents", "documentList"), p("totalPages", "number")], parametersSchema: z.object({ mode: z.enum(["document", "documents"]), ranges: z.array(z.object({ daPagina: z.number().int().positive(), aPagina: z.number().int().positive() }).strict()).min(1).max(100), filenameTemplate: z.string().min(1).max(200).default("{basename}-{index}.pdf") }).strict().superRefine((value, ctx) => {
    if (value.mode === "document" && value.ranges.length !== 1) ctx.addIssue({ code: "custom", path: ["ranges"], message: "La modalità documento richiede esattamente un intervallo." });
    for (const [index, range] of value.ranges.entries()) if (range.aPagina < range.daPagina) ctx.addIssue({ code: "custom", path: ["ranges", index, "aPagina"], message: "aPagina deve essere maggiore o uguale a daPagina." });
    if (value.filenameTemplate.includes("/") || value.filenameTemplate.includes("\\") || value.filenameTemplate.includes("..") || !value.filenameTemplate.toLowerCase().endsWith(".pdf")) ctx.addIssue({ code: "custom", path: ["filenameTemplate"], message: "Il modello deve essere un nome file PDF senza percorsi." });
    const placeholders = [...value.filenameTemplate.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    if (placeholders.some((name) => !["basename", "index", "daPagina", "aPagina"].includes(name)) || /\{[^{}]*\}/.test(value.filenameTemplate.replace(/\{(?:basename|index|daPagina|aPagina)\}/g, ""))) ctx.addIssue({ code: "custom", path: ["filenameTemplate"], message: "Placeholder ammessi: {basename}, {index}, {daPagina}, {aPagina}." });
  }), defaults: { mode: "documents", filenameTemplate: "{basename}-{index}.pdf" }, worker: { worker: "python", handlerId: "pdf.split", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.extract-pages", version: "1.0.0", category: "pages", label: "Estrai pagine", description: "Estrae le pagine selezionate.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ pages: pageNumbers }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.extract-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.delete-pages", version: "1.0.0", category: "pages", label: "Elimina pagine", description: "Rimuove le pagine selezionate.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ pages: pageNumbers }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.delete-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.delete-pages", version: "1.1.0", category: "pages", label: "Elimina pagine", description: "Rimuove pagine selezionate o, nel body di loop.eachPage, la pagina corrente con eliminazione differita.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ pages: pageNumbers.optional(), deleteCurrentPage: z.boolean().default(false) }).strict(), defaults: { deleteCurrentPage: false }, worker: { worker: "python", handlerId: "pdf.delete-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.page.delete", version: "1.0.0", category: "pages", label: "Elimina pagine selezionate", description: "Elimina pagine per numero o identificativo stabile, deduplicando i riferimenti e preservando le pagine restanti.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("deletedPages", "array"), p("deletedPageIds", "array")], parametersSchema: pageDeleteParametersSchema, defaults: {}, worker: { worker: "python", handlerId: "pdf.page.delete", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.page.insert", version: "1.0.0", category: "pages", label: "Inserisci pagine", description: "Inserisce pagine da un PDF selezionato in una posizione prima o dopo una pagina del documento, con mapping completo delle origini.", inputs: [p("pdf", "document", true), p("sources", "documentList", true)], outputs: [p("pdf", "document"), p("insertedCount", "number"), p("pageMap", "array")], parametersSchema: z.object({ sourceFile: z.string().trim().min(1).max(256), sourcePages: z.array(z.number().int().positive()).min(1).max(1000), targetPage: z.number().int().positive(), position: z.enum(["before", "after"]) }).strict().superRefine((value, ctx) => {
    if (new Set(value.sourcePages).size !== value.sourcePages.length) ctx.addIssue({ code: "custom", path: ["sourcePages"], message: "La stessa pagina sorgente non può essere inserita più volte." });
  }), defaults: { position: "after" }, worker: { worker: "python", handlerId: "pdf.page.insert", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.convert.pdfa", version: "1.0.0", category: "pages", label: "Converti PDF/A", description: "Converte un PDF in un profilo PDF/A supportato e ne conferma la conformità con veraPDF.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("validationReport", "object")], parametersSchema: z.object({ target: z.enum(["PDF/A-1b", "PDF/A-2b", "PDF/A-3b"]) }).strict(), defaults: { target: "PDF/A-2b" }, worker: { worker: "python", handlerId: "pdf.convert.pdfa", timeoutSeconds: 600, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.reorder-pages", version: "1.0.0", category: "pages", label: "Riordina pagine", description: "Riordina le pagine usando la lista legacy.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ order: pageNumbers }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.reorder-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.reorder-pages", version: "1.1.0", category: "pages", label: "Riordina pagine", description: "Riordina le pagine con pagina corrente e posizione in output.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ orderPlan: z.object({ pages: z.array(pageEntry).min(1) }).strict() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.reorder-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.rotate", version: "1.0.0", category: "pages", label: "Ruota pagine", description: "Ruota tutte o alcune pagine.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ degrees: z.number().default(90), pages: pageNumbers.optional() }).strict(), defaults: { degrees: 90 }, worker: { worker: "python", handlerId: "pdf.rotate", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.normalize-pages", version: "1.0.0", category: "pages", label: "Normalizza pagine", description: "Uniforma formato e orientamento delle pagine.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ pageSize: z.enum(["A4", "A3", "A5", "LETTER", "LEGAL"]), orientation: z.enum(["portrait", "landscape"]).optional(), fit: z.enum(["contain", "cover"]).optional() }).strict(), defaults: { pageSize: "A4", orientation: "portrait", fit: "contain" }, worker: { worker: "python", handlerId: "pdf.normalize-pages", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.page.normalize", version: "1.0.0", category: "pages", label: "Normalizza formato ISO", description: "Normalizza pagine verso A3, A4, A5 o A6 rispettando orientamento, tolleranza, ambito e ancoraggio senza ridurre pagine più grandi.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("modifiedPages", "array"), p("skippedPages", "array"), p("reason", "object")], parametersSchema: pageNormalizeParametersSchema, defaults: { size: "A4", orientation: "auto", tolerancePercent: 2, mode: "EXPAND_CANVAS", anchor: "CENTER", pageScope: "ALL" }, worker: { worker: "python", handlerId: "pdf.page.normalize", timeoutSeconds: 300, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.detect-page-size", version: "1.0.0", category: "analysis", label: "Rileva formato pagina", description: "Rileva formato e orientamento delle pagine.", inputs: [p("pdf", "document", true)], outputs: [p("pages", "array")], parametersSchema: z.object({ tolerancePoints: z.number().nonnegative().default(0) }).strict(), defaults: { tolerancePoints: 0 }, worker: { worker: "python", handlerId: "pdf.detect-page-size", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.detect-qr", version: "1.0.0", category: "analysis", label: "Rileva QR", description: "Rileva e decodifica i codici QR.", inputs: [p("pdf", "document", true)], outputs: [p("codes", "array")], parametersSchema: z.object({ pages: pageNumbers.optional() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.detect-qr", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.qr.readAll", version: "1.0.0", category: "analysis", label: "Leggi tutti i QR", description: "Scansiona un intervallo di pagine con concorrenza limitata e restituisce i QR ordinati per pagina e posizione.", inputs: [p("pdf", "document", true)], outputs: [p("codes", "array"), p("pagesScanned", "number")], parametersSchema: z.object({ startPage: z.number().int().positive().default(1), endPage: z.number().int().positive().optional(), dpi: z.number().int().min(72).max(600).default(200), preprocess: z.enum(["none", "grayscale", "autocontrast"]).default("none"), concurrency: z.number().int().min(1).max(8).default(2) }).strict().superRefine((value, ctx) => {
    if (value.endPage !== undefined && value.endPage < value.startPage) ctx.addIssue({ code: "custom", path: ["endPage"], message: "endPage deve essere maggiore o uguale a startPage." });
  }), defaults: { startPage: 1, dpi: 200, preprocess: "none", concurrency: 2 }, worker: { worker: "python", handlerId: "pdf.qr.readAll", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.qr.readPage", version: "1.0.0", category: "analysis", label: "Leggi QR pagina", description: "Rileva tutti i QR di una singola pagina con posizione raster e indicazione di trovato/non trovato.", inputs: [p("pdf", "document", true)], outputs: [p("codes", "array"), p("found", "boolean"), p("count", "number")], parametersSchema: z.object({ page: z.number().int().positive(), dpi: z.number().int().min(72).max(600).default(200), preprocess: z.enum(["none", "grayscale", "autocontrast"]).default("none") }).strict(), defaults: { dpi: 200, preprocess: "none" }, worker: { worker: "python", handlerId: "pdf.qr.readPage", timeoutSeconds: 120, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.qr.removeMatchedPages", version: "1.0.0", category: "pages", label: "Abbina QR, elimina pagina e segnalibro", description: "Confronta i QR di ogni pagina con l'elenco JSON, elimina le pagine corrispondenti e aggiunge il segnalibro alla successiva pagina conservata.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("matches", "array"), p("removedPages", "array"), p("bookmarks", "array")], parametersSchema: z.object({ records: z.array(z.object({ testoQR: z.string().min(1).max(4096), nomeQR: z.string().trim().min(1).max(500) }).strict()).min(1).max(10000), dpi: z.number().int().min(72).max(600).default(200), preprocess: z.enum(["none", "grayscale", "autocontrast"]).default("none") }).strict(), defaults: { dpi: 200, preprocess: "none" }, worker: { worker: "python", handlerId: "pdf.qr.removeMatchedPages", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.detect-barcode", version: "1.0.0", category: "analysis", label: "Rileva barcode", description: "Rileva e decodifica codici a barre.", inputs: [p("pdf", "document", true)], outputs: [p("codes", "array")], parametersSchema: z.object({ formats: stringList.optional(), pages: pageNumbers.optional() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.detect-barcode", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.remove-qr-pages", version: "1.0.0", category: "pages", label: "Rimuovi pagine con QR", description: "Rimuove le pagine che contengono QR.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("removedPages", "array")], parametersSchema: z.object({ match: z.enum(["any", "value"]).default("any"), value: z.string().optional() }).strict(), defaults: { match: "any" }, worker: { worker: "python", handlerId: "pdf.remove-qr-pages", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.ocr", version: "1.0.0", category: "analysis", label: "OCR", description: "Riconosce il testo e crea un overlay ricercabile.", inputs: [p("pdf", "document", true)], outputs: [p("text", "string"), p("pdf", "document")], parametersSchema: z.object({ languages: stringList.optional(), searchablePdf: z.boolean().default(true) }).strict(), defaults: { searchablePdf: true }, worker: { worker: "python", handlerId: "pdf.ocr", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.ocr", version: "1.1.0", category: "analysis", label: "OCR intervallo", description: "Esegue OCR su pagine selezionate, salta il testo già presente e crea un livello testuale ricercabile opzionale.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("extractedText", "string")], parametersSchema: z.object({ from: z.number().int().positive().default(1), to: z.number().int().positive().optional(), languages: z.array(z.string().regex(/^[A-Za-z0-9_]{2,16}$/)).max(8).default([]), dpi: z.number().int().min(72).max(600).default(300), skipExistingText: z.boolean().default(true), searchableOverlay: z.boolean().default(true), includeExtractedText: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
    if (value.to !== undefined && value.to < value.from) ctx.addIssue({ code: "custom", path: ["to"], message: "to deve essere maggiore o uguale a from." });
  }), defaults: { from: 1, languages: [], dpi: 300, skipExistingText: true, searchableOverlay: true, includeExtractedText: false }, worker: { worker: "python", handlerId: "pdf.ocr", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.ocr", version: "1.1.0", category: "analysis", label: "OCR intervallo", description: "Esegue OCR su pagine selezionate, salta il testo già presente e crea un livello testuale ricercabile opzionale.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document"), p("extractedText", "string")], parametersSchema: z.object({ from: z.number().int().positive().default(1), to: z.number().int().positive().optional(), languages: z.array(z.string().regex(/^[A-Za-z0-9_]{2,16}$/)).max(8).default([]), dpi: z.number().int().min(72).max(600).default(300), skipExistingText: z.boolean().default(true), searchableOverlay: z.boolean().default(true), includeExtractedText: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
    if (value.to !== undefined && value.to < value.from) ctx.addIssue({ code: "custom", path: ["to"], message: "to deve essere maggiore o uguale a from." });
  }), defaults: { from: 1, languages: [], dpi: 300, skipExistingText: true, searchableOverlay: true, includeExtractedText: false }, worker: { worker: "python", handlerId: "pdf.ocr", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "pdf.read-metadata", version: "1.0.0", category: "metadata", label: "Leggi metadati", description: "Legge i metadati del PDF.", inputs: [p("pdf", "document", true)], outputs: [p("metadata", "object")], parametersSchema: z.object({ includeXmp: z.boolean().default(true) }).strict(), defaults: { includeXmp: true }, worker: { worker: "python", handlerId: "pdf.read-metadata", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.write-metadata", version: "1.0.0", category: "metadata", label: "Scrivi metadati", description: "Aggiorna i metadati del PDF.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ title: z.string().optional(), author: z.string().optional(), subject: z.string().optional(), keywords: stringList.optional() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "pdf.write-metadata", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.bookmarks", version: "1.0.0", category: "metadata", label: "Segnalibri", description: "Aggiunge segnalibri e gerarchie.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ bookmarks: z.array(bookmark).default([]) }).strict(), defaults: { bookmarks: [] }, worker: { worker: "python", handlerId: "pdf.bookmarks", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "pdf.bookmark.add", version: "1.0.0", category: "metadata", label: "Aggiungi segnalibro", description: "Aggiunge un segnalibro a una pagina preservando l'outline esistente.", inputs: [p("pdf", "document", true)], outputs: [p("pdf", "document")], parametersSchema: z.object({ page: z.number().int().positive(), description: z.string().trim().min(1).max(500), level: z.number().int().min(0).max(8).default(0), parent: z.string().trim().min(1).max(500).optional() }).strict(), defaults: { level: 0 }, worker: { worker: "python", handlerId: "pdf.bookmark.add", timeoutSeconds: 120, resourceClass: "standard" }, enabled: true }),
  defineBlock({ type: "flow.condition", version: "1.0.0", category: "flow", label: "Condizione", description: "Dirama il flusso con una condizione dichiarativa.", inputs: [p("value", "document", true)], outputs: [p("true", "control", false, true), p("false", "control", false, true), p("value", "document")], parametersSchema: z.object({ conditionType: z.enum(["qrFound", "pageCount", "pageSize", "textContains", "parameterComparison"]), path: z.string().optional(), operator: z.enum(["equals", "notEquals", "contains", "greaterThan", "lessThan", "exists"]), value: jsonValue.optional() }).strict(), defaults: {}, worker: { worker: "python", handlerId: "flow.condition", timeoutSeconds: 300, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "logic.if", version: "1.0.0", category: "flow", label: "IF / ELSE", description: "Confronta due valori tipizzati da binding dichiarativi e attiva un solo ramo.", inputs: [], outputs: [p("true", "control", false, true), p("false", "control", false, true)], parametersSchema: logicIfParametersSchema, defaults: { operator: "eq", leftType: "string", rightType: "string", caseSensitive: false, nullBehavior: "equalOnly" }, worker: { worker: "python", handlerId: "logic.if", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "logic.conditionGroup", version: "1.0.0", category: "flow", label: "Condizioni composte", description: "Combina confronti tipizzati con gruppi AND/OR/NOT e attiva il ramo booleano corrispondente.", inputs: [], outputs: [p("boolean", "boolean"), p("true", "control", false, true), p("false", "control", false, true)], parametersSchema: conditionGroupParametersSchema, defaults: {}, worker: { worker: "python", handlerId: "logic.conditionGroup", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "loop.eachPage", version: "1.0.0", category: "loop", label: "Per ogni pagina", description: "Esegue il ramo body per ogni pagina della fotografia iniziale; raccoglie le eliminazioni e le applica usando gli indici originali.", inputs: [p("document", "document", true)], outputs: [p("document", "document"), p("currentPage", "number"), p("pageId", "string"), p("pageCount", "number"), p("index", "number"), p("body", "control", true, true), p("after", "control", true, true)], parametersSchema: z.object({ start: z.number().int().positive().default(1), end: z.number().int().positive().optional(), step: z.number().int().positive().default(1), maxIterations: z.number().int().positive().max(1000).default(1000) }).strict(), defaults: { start: 1, step: 1, maxIterations: 1000 }, worker: { worker: "orchestrator", handlerId: "loop.eachPage", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "loop.forEach", version: "1.0.0", category: "loop", label: "Per ogni elemento", description: "Esegue il ramo body per ogni riga di un array JSON o di una tabella rows; espone item e index nello scope tipizzato.", inputs: [], outputs: [p("items", "array"), p("count", "number"), p("body", "control", true, true), p("after", "control", true, true)], parametersSchema: forEachParametersSchema, defaults: { itemType: "object", columns: [], maxIterations: 1000 }, worker: { worker: "orchestrator", handlerId: "loop.forEach", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "loop.forEach", version: "1.1.0", category: "loop", label: "Per ogni elemento o PDF", description: "Scorre array JSON o una documentList; espone il PDF corrente al ramo body, raccoglie i PDF elaborati e gli output di ogni iterazione.", inputs: [], outputs: [p("items", "array"), p("count", "number"), p("document", "document"), p("documents", "documentList"), p("results", "array"), p("body", "control", true, true), p("after", "control", true, true)], parametersSchema: forEachDocumentParametersSchema, defaults: { itemType: "object", columns: [], maxIterations: 1000 }, worker: { worker: "orchestrator", handlerId: "loop.forEach", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "loop.while", version: "1.0.0", category: "loop", label: "WHILE", description: "Verifica la condizione prima di ogni iterazione ed esegue body finché è vera; poi attiva after.", inputs: [], outputs: [p("iteration", "number"), p("body", "control", true, true), p("after", "control", true, true)], parametersSchema: conditionalLoopParametersSchema, defaults: { timeoutSeconds: 900 }, worker: { worker: "orchestrator", handlerId: "loop.while", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "loop.repeatUntil", version: "1.0.0", category: "loop", label: "REPEAT UNTIL", description: "Esegue body almeno una volta e verifica la condizione dopo ogni iterazione; termina quando è vera e attiva after.", inputs: [], outputs: [p("iteration", "number"), p("body", "control", true, true), p("after", "control", true, true)], parametersSchema: conditionalLoopParametersSchema, defaults: { timeoutSeconds: 900 }, worker: { worker: "orchestrator", handlerId: "loop.repeatUntil", timeoutSeconds: 900, resourceClass: "large" }, enabled: true }),
  defineBlock({ type: "flow.break", version: "1.0.0", category: "flow", label: "Interrompi ciclo", description: "Termina il ciclo più interno che contiene questo blocco e prosegue dal suo ramo after.", inputs: [], outputs: [p("break", "control")], parametersSchema: emptyFlowParametersSchema, defaults: {}, worker: { worker: "orchestrator", handlerId: "flow.break", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "flow.continue", version: "1.0.0", category: "flow", label: "Continua ciclo", description: "Salta il resto del body corrente e avvia l'iterazione successiva del ciclo più interno.", inputs: [], outputs: [p("continue", "control")], parametersSchema: emptyFlowParametersSchema, defaults: {}, worker: { worker: "orchestrator", handlerId: "flow.continue", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "flow.jumpPage", version: "1.0.0", category: "flow", label: "Salta pagina", description: "Nel body di Per ogni pagina passa a una pagina assoluta o a un offset relativo. Il target deve rimanere nell'intervallo configurato del loop.", inputs: [], outputs: [p("jump", "control")], parametersSchema: jumpPageParametersSchema, defaults: {}, worker: { worker: "orchestrator", handlerId: "flow.jumpPage", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "data.lookup", version: "1.0.0", category: "analysis", label: "Cerca in elenco", description: "Cerca righe JSON o un record di metadati con confronto esatto, contiene o intervallo; restituisce primo risultato o tutti e dirama su trovato/non trovato.", inputs: [p("items", "array"), p("record", "object")], outputs: [p("value", "object"), p("values", "array"), p("found", "control", false, true), p("notFound", "control", false, true)], parametersSchema: lookupParametersSchema, defaults: { result: "object", cardinality: "first", nullBehavior: "skip" }, worker: { worker: "python", handlerId: "data.lookup", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "data.setVariable", version: "1.0.0", category: "flow", label: "Imposta variabile", description: "Imposta una variabile tipizzata nello scope workflow o nel frame del ciclo corrente.", inputs: [], outputs: [p("value", "object")], parametersSchema: setVariableParametersSchema, defaults: {}, worker: { worker: "orchestrator", handlerId: "data.setVariable", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
  defineBlock({ type: "flow.merge", version: "1.0.0", category: "flow", label: "Unisci flusso", description: "Raccoglie valori da più rami.", inputs: [p("values", "object", true, true)], outputs: [p("value", "object")], parametersSchema: z.object({ strategy: z.enum(["first", "all"]).default("first") }).strict(), defaults: { strategy: "first" }, worker: { worker: "python", handlerId: "flow.merge", timeoutSeconds: 30, resourceClass: "small" }, enabled: true }),
];

export const blockRegistry: readonly BlockDefinition[] = Object.freeze(defs);
export const latestBlockRegistry: readonly BlockDefinition[] = Object.freeze(
  Array.from(new Map(defs.filter((item) => item.enabled).map((item) => [item.type, item])).values()),
);

export function getBlockDefinition(type: string, version?: string): BlockDefinition | null {
  if (version !== undefined) return blockRegistry.find((item) => item.type === type && item.version === version) ?? null;
  return latestBlockRegistry.find((item) => item.type === type) ?? null;
}

export function toBlockDefinitionDto(block: BlockDefinition) {
  const tool = toLegacyToolDefinition(block);
  return {
    ...tool,
    type: block.type,
    icon: block.iconName,
    color: block.color,
    label: block.label,
    ports: { inputs: block.inputs, outputs: block.outputs },
    defaults: block.defaults,
    requiredParameters: block.requiredParameters,
    worker: block.worker,
  };
}

export function toLegacyToolDefinition(block: BlockDefinition) {
  const legacyType = (type: BlockPortType) => ({
    control: "application/json", document: "application/pdf", documentList: "application/pdf[]",
    string: "text/plain", number: "number", boolean: "boolean", object: "application/json", array: "application/json[]",
  })[type];
  const schema = z.toJSONSchema(block.parametersSchema, { target: "draft-7" });
  return toolDefinitionSchema.parse({
    id: block.type,
    version: block.version,
    name: block.label,
    description: block.description,
    category: block.category,
    runtime: block.worker.worker === "python" ? "PYTHON" : "NODE",
    inputPorts: block.inputs.map((item) => ({ name: item.id, type: legacyType(item.type), required: item.required ?? false })),
    outputPorts: block.outputs.map((item) => ({ name: item.id, type: legacyType(item.type) })),
    parametersSchema: schema,
    timeoutSeconds: block.worker.timeoutSeconds,
    resourceClass: block.worker.resourceClass,
    enabled: block.enabled,
  });
}

export const blockCatalogDocumentation = latestBlockRegistry.map((block) => ({
  type: block.type,
  version: block.version,
  category: block.category,
  label: block.label,
  icon: block.iconName,
  color: block.color,
  inputs: block.inputs,
  outputs: block.outputs,
  parameters: z.toJSONSchema(block.parametersSchema, { target: "draft-7" }),
  defaults: block.defaults,
  requiredParameters: block.requiredParameters,
  worker: block.worker,
}));
