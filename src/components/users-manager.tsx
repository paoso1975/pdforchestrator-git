"use client";

import { useCallback, useEffect, useState } from "react";
import type { ManagedUser } from "@/lib/types/users";

type ApiResult = { users?: ManagedUser[]; error?: string; total?: number | null };

export function UsersManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("user");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}&perPage=50`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "Impossibile caricare gli utenti.");
      setUsers(result.users ?? []);
      setTotal(result.total ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Errore di rete.");
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadUsers(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, role }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "Impossibile invitare l'utente.");
      setEmail(""); setDisplayName(""); setRole("user");
      setNotice("Invito inviato via email.");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Errore di rete.");
    } finally { setBusy(false); }
  }

  async function updateUser(user: ManagedUser, changes: Partial<Pick<ManagedUser, "displayName" | "role">>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
      });
      const result = await response.json() as ApiResult & { user?: ManagedUser };
      if (!response.ok) throw new Error(result.error ?? "Impossibile aggiornare l'utente.");
      setNotice("Utente aggiornato."); await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Errore di rete.");
    } finally { setBusy(false); }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Eliminare definitivamente l'account ${user.email ?? user.id}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "Impossibile eliminare l'utente.");
      setNotice("Account eliminato."); await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Errore di rete.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-9 space-y-7">
      <form onSubmit={createUser} className="grid gap-4 rounded-2xl border border-[#293744] bg-[#101923] p-5 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end sm:p-6">
        <label className="text-sm font-medium">Email
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="utente@azienda.it" className="mt-2 w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-slate-100 outline-none focus:border-[#5485cf]" />
        </label>
        <label className="text-sm font-medium">Nome
          <input maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nome visualizzato" className="mt-2 w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-slate-100 outline-none focus:border-[#5485cf]" />
        </label>
        <label className="text-sm font-medium">Ruolo
          <select value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-slate-100">
            <option value="user">Utente</option><option value="admin">Admin</option>
          </select>
        </label>
        <button disabled={busy} className="rounded-lg bg-[#136EF9] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#2E7BFA] disabled:opacity-50">Invita</button>
      </form>

      <div className="rounded-2xl border border-[#293744] bg-[#101923] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div><h2 className="text-lg font-semibold">Account</h2><p className="mt-1 text-sm text-slate-500">Eliminare un account revoca subito il suo accesso.</p></div>
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Cerca email o nome" aria-label="Cerca utenti" className="rounded-lg border border-[#2b3b47] bg-[#0b141d] px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-[#5485cf]" />
        </div>
        {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-[#293744] text-xs uppercase tracking-wide text-slate-500"><th className="pb-3 pr-4 font-medium">Utente</th><th className="pb-3 pr-4 font-medium">Ruolo</th><th className="pb-3 pr-4 font-medium">Stato email</th><th className="pb-3 pr-4 font-medium">Registrato</th><th className="pb-3 text-right font-medium">Azioni</th></tr></thead>
            <tbody className="divide-y divide-[#202d38]">
              {loading ? <tr><td colSpan={5} className="py-10 text-center text-slate-500">Caricamento utenti…</td></tr> : users.length === 0 ? <tr><td colSpan={5} className="py-10 text-center text-slate-500">Nessun utente trovato.</td></tr> : users.map((user) => (
                <tr key={user.id}>
                  <td className="py-4 pr-4"><p className="font-medium">{user.displayName || "—"}</p><p className="mt-1 text-xs text-slate-500">{user.email ?? "Email assente"}</p></td>
                  <td className="py-4 pr-4"><select disabled={busy} value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value })} aria-label={`Ruolo di ${user.email}`} className="rounded-lg border border-[#2b3b47] bg-[#0b141d] px-2.5 py-1.5 text-slate-100"><option value="user">Utente</option><option value="admin">Admin</option></select></td>
                  <td className="py-4 pr-4"><span className={`rounded-full px-2.5 py-1 text-xs ${user.emailConfirmed ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{user.emailConfirmed ? "Confermata" : "In attesa"}</span></td>
                  <td className="py-4 pr-4 text-slate-500">{new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(user.createdAt))}</td>
                  <td className="py-4 text-right"><button disabled={busy} onClick={() => void deleteUser(user)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/30 disabled:opacity-50">Elimina</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && total > 50 && <div className="mt-4 flex items-center justify-between text-sm text-slate-500"><span>{total} account</span><div className="flex gap-2"><button disabled={page <= 1 || busy} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-[#293744] px-3 py-1.5 hover:bg-[#17232e] disabled:opacity-40">Precedenti</button><span className="px-2 py-1.5">Pagina {page} di {Math.ceil(total / 50)}</span><button disabled={page >= Math.ceil(total / 50) || busy} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-[#293744] px-3 py-1.5 hover:bg-[#17232e] disabled:opacity-40">Successivi</button></div></div>}
      </div>
    </div>
  );
}
