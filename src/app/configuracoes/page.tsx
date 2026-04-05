import { ConfiguracoesCards } from "@/components/configuracoes/configuracoes-cards";

export default function ConfiguracoesPage() {
  return (
    <section className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <h1 className="text-xl font-semibold text-slate-100">Configuracoes</h1>
        <p className="mt-1 text-sm text-slate-400">
          Gerencie responsaveis e integracoes do CRM em modulos separados.
        </p>
      </div>

      <ConfiguracoesCards />
    </section>
  );
}
