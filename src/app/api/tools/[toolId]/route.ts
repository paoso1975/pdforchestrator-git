import { NextResponse, type NextRequest } from "next/server";
import { getBlockDefinition, toBlockDefinitionDto } from "@/lib/blocks/registry";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await context.params;
    const tool = getBlockDefinition(decodeURIComponent(toolId));
    if (!tool || !tool.enabled) return NextResponse.json({ error: "Strumento non trovato." }, { status: 404 });
    return NextResponse.json(toBlockDefinitionDto(tool));
  } catch (error) {
    return validationError(error);
  }
}
