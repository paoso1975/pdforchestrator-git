import { z } from "zod";
import { apiObjectSchema, batchGraphSchema } from "@/lib/schemas/api";

export const MAX_BATCH_DRAFT_BYTES = 5 * 1024 * 1024;

export const batchDraftExportSchema = z.object({
  formatVersion: z.literal(1),
  batchName: z.string().trim().min(1).max(120),
  graph: batchGraphSchema,
  inputSchema: apiObjectSchema,
  outputSchema: apiObjectSchema,
}).strict();

export function isWithinBatchDraftLimit(text: string): boolean {
  return new TextEncoder().encode(text).byteLength <= MAX_BATCH_DRAFT_BYTES;
}
