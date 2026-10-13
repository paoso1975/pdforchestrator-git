import Link from "next/link";
import { redirect } from "next/navigation";
import { BatchRunWorkbench, type RunnableBatch } from "@/components/batch-run-workbench";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export default async function ExecuteBatchPage() {
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/login");

  const batches = await prisma.batch.findMany({
    where: {
      status: "PUBLISHED",
      activeVersion: { is: { publishedAt: { not: null } } },
      organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN", "OPERATOR"] } } } },
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      slug: true,
      activeVersion: { select: { version: true, inputSchema: true, outputSchema: true, graph: true, publishedAt: true } },
    },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
  });

  const runnableBatches: RunnableBatch[] = batches.flatMap((batch) => batch.activeVersion ? [{
    id: batch.id,
    organizationId: batch.organizationId,
    name: batch.name,
    slug: batch.slug,
    version: batch.activeVersion.version,
    inputSchema: batch.activeVersion.inputSchema,
    outputSchema: batch.activeVersion.outputSchema,
    graph: batch.activeVersion.graph,
  }] : []);

  return (
    <main className="min-h-dvh bg-[#0a1017] px-4 py-7 text-slate-100 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-[1500px]">
          <header className="flex items-center justify-between border-b border-[#25313c] pb-6">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight text-white">PDF<span className="text-[#2E7BFA]">Orchestrator</span></Link>
          <Link href="/dashboard" className="rounded-lg border border-[#2A5FB8] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-[#136EF9] hover:bg-[#13213a] hover:text-white">← Dashboard</Link>
        </header>
        <section className="py-8 sm:py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#2E7BFA]">Esecuzione</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Avvia un batch</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Seleziona una versione pubblicata, carica i PDF sul server e crea un job asincrono. Qui puoi seguire lo stato e scaricare gli artifact.</p>
        </section>
        <BatchRunWorkbench batches={runnableBatches} />
      </div>
    </main>
  );
}
