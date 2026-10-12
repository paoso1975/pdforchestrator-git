import { z } from "zod";

export const emptyFlowParametersSchema = z.object({}).strict();

export const jumpPageParametersSchema = z.object({
  targetMode: z.enum(["absolute", "relative"]).describe("Pagina assoluta oppure spostamento relativo alla pagina corrente."),
  value: z.number().int().describe("Pagina di destinazione 1-based (assoluto) oppure offset intero non nullo (relativo)."),
}).strict();

export function validateJumpPageParameters(value: unknown): string[] {
  const parsed = jumpPageParametersSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  if (parsed.data.targetMode === "absolute" && parsed.data.value < 1) return ["value: la pagina assoluta deve essere almeno 1."];
  if (parsed.data.targetMode === "relative" && parsed.data.value === 0) return ["value: lo spostamento relativo non può essere zero."];
  return [];
}
