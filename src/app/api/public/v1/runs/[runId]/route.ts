import { GET as getRun } from "@/app/v1/executions/[executionId]/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  const { runId } = await context.params;
  return getRun(request, { params: Promise.resolve({ executionId: runId }) });
}
