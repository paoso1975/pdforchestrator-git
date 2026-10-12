import { GET as getUpload } from "@/app/v1/uploads/[id]/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return getUpload(request, context);
}
