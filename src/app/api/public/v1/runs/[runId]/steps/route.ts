import { GET as getSteps } from "@/app/v1/executions/[executionId]/steps/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  const { runId } = await context.params;
  return getSteps(request, { params: Promise.resolve({ executionId: runId }) });
}
