import { mkdir, writeFile } from "node:fs/promises";
import { blockCatalogDocumentation } from "../src/lib/blocks/registry";

const categories: Record<string, string> = { input: "Input", output: "Output", pages: "Pagine", analysis: "Analisi", metadata: "Metadati", flow: "Flusso" };
const lines = ["# Catalogo dei blocchi", "", "Generato dal registry condiviso. Rigenerare con `npm run docs:blocks`; non modificare manualmente.", ""];
for (const block of blockCatalogDocumentation) {
  lines.push(`## \`${block.type}@${block.version}\` — ${block.label}`, "", `Categoria: ${categories[block.category] ?? block.category}. Icona Lucide: \`${block.icon}\`. Handler: \`${block.worker.handlerId}\` (${block.worker.worker}).`, "", `Porte input: ${block.inputs.map((port) => `\`${port.id}: ${port.type}${port.required ? " (obbligatorio)" : ""}${port.multiple ? " (multiplo)" : ""}\``).join(", ") || "nessuna"}.`, `Porte output: ${block.outputs.map((port) => `\`${port.id}: ${port.type}\``).join(", ") || "nessuna"}.`, "", "Default:", "", "```json", JSON.stringify(block.defaults, null, 2), "```", "", "Schema parametri:", "", "```json", JSON.stringify(block.parameters, null, 2), "```", "");
}
void (async () => {
  await mkdir("docs", { recursive: true });
  await writeFile("docs/block-catalog.md", `${lines.join("\n")}\n`, "utf8");
})();
