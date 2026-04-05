import Link from "next/link";
import { Api4Module } from "@/components/configuracoes/integracoes/api4/api4-module";

export default function ConfiguracoesApi4Page() {
  return (
    <section className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Configuracoes / Integracoes / API4</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">API4</h1>
            <p className="mt-1 text-sm text-slate-400">Cadastre e gerencie multiplos ramais da API4 sem sobrescrever a conexao atual.</p>
          </div>
          <Link href="/configuracoes/integracoes" className="btn-ghost">
            Voltar
          </Link>
        </div>
      </div>

      <Api4Module />
    </section>
  );
}
