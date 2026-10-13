import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { createStorageClient } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const organizationId = z.string().uuid().parse(request.nextUrl.searchParams.get("organizationId"));
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!membership || !["OWNER", "ADMIN", "OPERATOR"].includes(membership.role)) {
      return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    }

    const files = await prisma.storedFile.findMany({
      where: {
        organizationId,
        kind: "INPUT",
        uploadState: "UPLOADED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, bucket: true, objectKey: true, filename: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const storage = createStorageClient();
    const available: Array<{ id: string; filename: string; sizeBytes: string; sha256: string; createdAt: Date }> = [];
    for (let offset = 0; offset < files.length; offset += 8) {
      const chunk = files.slice(offset, offset + 8);
      const verified = await Promise.all(chunk.map(async (file) => {
        try {
          const head = await storage.send(new HeadObjectCommand({ Bucket: file.bucket, Key: file.objectKey }));
          if (head.ContentLength !== Number(file.sizeBytes) || head.ContentType !== "application/pdf") return null;
          return { id: file.id, filename: file.filename, sizeBytes: file.sizeBytes.toString(), sha256: file.sha256, createdAt: file.createdAt };
        } catch {
          return null;
        }
      }));
      available.push(...verified.filter((file): file is NonNullable<typeof file> => file !== null));
    }
    return NextResponse.json(available);
  } catch (error) {
    return validationError(error);
  }
}
