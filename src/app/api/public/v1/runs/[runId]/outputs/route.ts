import { GET as getOutputs } from "@/app/v1/executions/[executionId]/outputs/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  const { runId } = await context.params;
  return getOutputs(request, { params: Promise.resolve({ executionId: runId }) });
}
