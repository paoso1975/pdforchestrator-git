import { NextResponse } from "next/server";
import { latestBlockRegistry, toBlockDefinitionDto } from "@/lib/blocks/registry";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(latestBlockRegistry.map(toBlockDefinitionDto));
  } catch (error) {
    return validationError(error);
  }
}
