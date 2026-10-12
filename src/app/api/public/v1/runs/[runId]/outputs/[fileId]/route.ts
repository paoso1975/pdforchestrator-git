import { GET as getOutput } from "@/app/v1/executions/[executionId]/outputs/[fileId]/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string; fileId: string }> };

export async function GET(request: Request, context: Context) {
  const { runId, fileId } = await context.params;
  return getOutput(request, { params: Promise.resolve({ executionId: runId, fileId }) });
}
