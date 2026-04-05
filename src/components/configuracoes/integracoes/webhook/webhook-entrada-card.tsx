type WebhookEntradaCardProps = {
  endpoint: string;
  ativo: boolean;
  ultimoEventoRecebido: string | null;
  onCopiarUrl: () => void;
  onTestarRecebimento: () => void;
};

function formatDateTime(value: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusClasses(active: boolean) {
  return active
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

export function WebhookEntradaCard({
  endpoint,
  ativo,
  ultimoEventoRecebido,
  onCopiarUrl,
  onTestarRecebimento,
}: WebhookEntradaCardProps) {
  return (
    <article className="rounded-xl border border-border bg-slate-900/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Webhook de entrada</h3>
          <p className="text-xs text-slate-400">Endpoint que recebe eventos externos</p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusClasses(ativo)}`}>
          {ativo ? "Ativo" : "Inativo"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Endpoint
          <input className="field mt-1" readOnly value={endpoint} />
        </label>

        <div className="rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ultimo evento recebido</p>
          <p className="mt-1">{formatDateTime(ultimoEventoRecebido)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onCopiarUrl}>
          Copiar URL
        </button>
        <button type="button" className="btn-primary" onClick={onTestarRecebimento}>
          Testar recebimento
        </button>
      </div>
    </article>
  );
}
