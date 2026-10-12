import { POST as createRun } from "@/app/v1/batches/[batchId]/executions/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: Context) {
  const { slug } = await context.params;
  return createRun(request, { params: Promise.resolve({ batchId: slug }) });
}
