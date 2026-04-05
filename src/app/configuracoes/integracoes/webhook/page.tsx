import Link from "next/link";
import { WebhookModule } from "@/components/configuracoes/integracoes/webhook/webhook-module";

export default function ConfiguracoesWebhookPage() {
  return (
    <section className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Configuracoes / Integracoes / Webhook</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-100">Webhook</h1>
            <p className="mt-1 text-sm text-slate-400">Gerencie webhook de entrada e webhook de saida.</p>
          </div>
          <Link href="/configuracoes/integracoes" className="btn-ghost">
            Voltar
          </Link>
        </div>
      </div>

      <WebhookModule />
    </section>
  );
}
