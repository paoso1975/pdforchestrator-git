import "server-only";

import { prisma } from "@/lib/prisma";

export async function getAccessibleOrganizations(userId: string) {
  return prisma.organization.findMany({
    where: { memberships: { some: { userId } } },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      memberships: { where: { userId }, select: { role: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getMembership(userId: string, organizationId: string) {
  return prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
}
