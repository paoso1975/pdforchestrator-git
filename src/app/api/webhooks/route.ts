import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-vault";
import { validateWebhookUrl } from "@/lib/webhook-security";
import { validationError } from "@/lib/validation";
export const runtime = "nodejs";
const schema = z.object({ organizationId: z.string().uuid(), url: z.string().url().max(2048), eventTypes: z.array(z.enum(["execution.completed", "execution.failed", "execution.cancelled"])).min(1).max(3) }).strict();
export async function GET() {
  try { const userId = await getAuthenticatedUserId(); if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } } },
      select: { id: true, organizationId: true, url: true, eventTypes: true, enabled: true, createdAt: true, deliveries: { select: { status: true, attempts: true, deliveredAt: true, lastError: true }, orderBy: { createdAt: "desc" }, take: 20 } },
    });
    return NextResponse.json(endpoints);
  } catch (error) { return validationError(error); }
}
export async function POST(request: Request) {
  try { const userId = await getAuthenticatedUserId(); if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const body = schema.parse(await request.json()); const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: body.organizationId, userId } } });
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    const url = await validateWebhookUrl(body.url); const secret = randomBytes(32).toString("base64url"); const encrypted = encryptSecret(secret);
    const endpoint = await prisma.webhookEndpoint.create({ data: { organizationId: body.organizationId, url, secret: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag, secretKeyVersion: encrypted.keyVersion, eventTypes: body.eventTypes }, select: { id: true, organizationId: true, url: true, eventTypes: true, enabled: true, createdAt: true } });
    return NextResponse.json({ endpoint, secret }, { status: 201 });
  } catch (error) { if (error instanceof Error && error.message.includes("Webhook")) return NextResponse.json({ error: error.message }, { status: 400 }); return validationError(error); }
}
