import { GET as signPart } from "@/app/v1/uploads/[id]/parts/[partNumber]/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; partNumber: string }> };
export async function GET(request: Request, context: Context) {
  return signPart(request, context);
}
