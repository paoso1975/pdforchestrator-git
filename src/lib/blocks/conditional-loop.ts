import { z } from "zod";
import { conditionAstSchema } from "@/lib/blocks/condition-group";

export const conditionalLoopParametersSchema = z.object({
  condition: conditionAstSchema.describe("Condizione dichiarativa verificata a ogni iterazione."),
  maxIterations: z.number().int().positive().max(1000).describe("Limite obbligatorio di iterazioni (1–1000)."),
  timeoutSeconds: z.number().int().positive().max(900).default(900).describe("Timeout complessivo del ciclo, in secondi (massimo 900)."),
}).strict();
