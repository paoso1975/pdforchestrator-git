import { POST as completeUpload } from "@/app/v1/uploads/[id]/complete/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return completeUpload(request, context);
}
