import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const suppliedId = request.headers.get("x-request-id");
  const requestId = suppliedId && /^[0-9a-f-]{36}$/i.test(suppliedId) ? suppliedId : randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  const forwardedRequest = new NextRequest(request, { headers });
  const response = await updateSession(forwardedRequest);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
