import { signIn, signUp } from "./actions";
import Link from "next/link";

type LoginPageProps = { searchParams: Promise<{ error?: string; message?: string; next?: string }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a1017] px-5 py-12 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-[#293744] bg-[#101923] p-8 shadow-2xl shadow-black/20 sm:p-10">
        <Link href="/" className="text-sm font-bold tracking-tight">PDF<span className="text-[#2E7BFA]">Orchestrator</span></Link>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-[#2E7BFA]">Area riservata</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Bentornato</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Accedi per gestire i tuoi batch e documenti PDF.</p>
        {params.error && <p role="alert" className="mt-5 rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-200">{params.error}</p>}
        {params.message && <p role="status" className="mt-5 rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">{params.message}</p>}
        <form className="mt-7 space-y-4">
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          <label className="block text-sm font-medium">Email
            <input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#5485cf] focus:ring-2 focus:ring-[#5485cf]/15" placeholder="nome@azienda.it" />
          </label>
          <label className="block text-sm font-medium">Password
            <input name="password" type="password" autoComplete="current-password" minLength={8} required className="mt-2 w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#5485cf] focus:ring-2 focus:ring-[#5485cf]/15" placeholder="Almeno 8 caratteri" />
          </label>
          <button formAction={signIn} className="w-full rounded-lg bg-[#136EF9] px-4 py-3 font-semibold text-white transition hover:bg-[#2E7BFA]">Accedi</button>
          <button formAction={signUp} className="w-full rounded-lg border border-[#2b3b47] px-4 py-3 font-medium text-slate-300 transition hover:bg-[#17232e]">Crea un account</button>
        </form>
      </section>
    </main>
  );
}
