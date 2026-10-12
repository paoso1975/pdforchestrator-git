import { NextResponse } from "next/server";
import { uuidSchema } from "@/lib/schemas/api";
import { executionForRequest } from "@/lib/execution-auth";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const executionId = uuidSchema.parse((await context.params).executionId);
    const result = await executionForRequest(executionId, request);
    if (result.response) return result.response;
    return NextResponse.json({ ...result.execution, events: result.execution.events });
  } catch (error) { return validationError(error); }
}
