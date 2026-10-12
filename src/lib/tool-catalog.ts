import { z } from "zod";
import { blockRegistry, getBlockDefinition, latestBlockRegistry, toLegacyToolDefinition } from "@/lib/blocks/registry";
import { toolDefinitionSchema } from "@/lib/schemas/api";

/** Compatibility projection for the existing batch API and the Python worker manifest. */
export const toolCatalog = latestBlockRegistry.map(toLegacyToolDefinition);
export type ToolDefinitionDto = z.infer<typeof toolDefinitionSchema>;

export function getToolDefinition(logicalId: string) {
  const block = latestBlockRegistry.find((item) => item.type === logicalId);
  return block ? toLegacyToolDefinition(block) : null;
}

export function getToolDefinitionVersion(logicalId: string, version: string) {
  const block = getBlockDefinition(logicalId, version);
  return block ? toLegacyToolDefinition(block) : null;
}

export { blockRegistry, latestBlockRegistry, getBlockDefinition };
