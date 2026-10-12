import { POST as cancelRun } from "@/app/v1/executions/[executionId]/cancel/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: Context) {
  const { runId } = await context.params;
  return cancelRun(request, { params: Promise.resolve({ executionId: runId }) });
}
