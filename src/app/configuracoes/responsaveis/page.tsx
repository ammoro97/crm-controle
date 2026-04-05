import Link from "next/link";
import { ResponsaveisManager } from "@/components/configuracoes/responsaveis-manager";

export default function ConfiguracoesResponsaveisPage() {
  return (
    <section className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Configuracoes</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">Responsaveis</h1>
            <p className="mt-1 text-sm text-slate-400">Cadastre e mantenha os responsaveis comerciais do CRM.</p>
          </div>
          <Link href="/configuracoes" className="btn-ghost">
            Voltar
          </Link>
        </div>
      </div>

      <ResponsaveisManager />
    </section>
  );
}
