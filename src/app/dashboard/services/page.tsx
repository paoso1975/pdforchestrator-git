import { redirect } from "next/navigation";
import Link from "next/link";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { AdminServiceHealth } from "@/components/admin-service-health";

export default async function ServicesPage() {
  if (!await isCurrentUserAdmin()) redirect("/dashboard");
  return <main className="min-h-dvh bg-[#0a1017] px-5 py-8 text-slate-100 sm:px-10">
    <div className="mx-auto max-w-6xl">
      <header className="flex items-center justify-between border-b border-[#25313c] pb-6">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight text-white">PDF<span className="text-[#2E7BFA]">Orchestrator</span></Link>
        <Link href="/dashboard" className="rounded-lg border border-[#2A5FB8] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-[#136EF9] hover:bg-[#13213a] hover:text-white">← Dashboard</Link>
      </header>
      <section className="py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2E7BFA]">Amministrazione</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Servizi e configurazione</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Stato dei collegamenti esterni utilizzati dall’applicazione. I valori segreti non vengono mai restituiti; per i webhook configurati dai tenant non vengono effettuate richieste.</p>
        <AdminServiceHealth />
      </section>
    </div>
  </main>;
}
