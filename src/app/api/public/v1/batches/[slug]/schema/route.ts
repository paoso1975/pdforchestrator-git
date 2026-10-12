import { GET as getSchema } from "@/app/v1/batches/[batchId]/schema/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  return getSchema(request, { params: Promise.resolve({ batchId: slug }) });
}
