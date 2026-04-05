import type { StatusIntegracao } from "@/types/integrations";

export type Api4RamalView = {
  id: string;
  nome: string;
  ramal: string;
  gateway: string;
  tokenMasked: string;
  hasToken: boolean;
  status: StatusIntegracao;
  isConnected: boolean;
  responsavelId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isPrimary: boolean;
};

type Api4RamalCardProps = {
  item: Api4RamalView;
  testingId: string | null;
  onEdit: (item: Api4RamalView) => void;
  onTest: (item: Api4RamalView) => void;
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusMeta(status: StatusIntegracao, hasToken: boolean, isConnected: boolean) {
  if (!hasToken) {
    return {
      label: "Nao configurado",
      classes: "border-slate-600 bg-slate-800/70 text-slate-300",
    };
  }

  if (status === "erro") {
    return {
      label: "Erro",
      classes: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    };
  }

  if (status === "ativo" || isConnected) {
    return {
      label: "Conectado",
      classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    };
  }

  return {
    label: "Configurado",
    classes: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  };
}

export function Api4RamalCard({ item, testingId, onEdit, onTest }: Api4RamalCardProps) {
  const status = getStatusMeta(item.status, item.hasToken, item.isConnected);
  const testing = testingId === item.id;

  return (
    <article className="rounded-xl border border-border bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100">{item.nome}</h3>
            {item.isPrimary ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                Principal
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-400">Ramal independente da API4.</p>
        </div>

        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${status.classes}`}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ramal</p>
          <p className="mt-1 rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
            {item.ramal || "-"}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Gateway</p>
          <p className="mt-1 rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
            {item.gateway || "-"}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Token</p>
          <p className="mt-1 rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
            {item.tokenMasked}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Atualizado em</p>
          <p className="mt-1 rounded-lg border border-border bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
            {formatDateTime(item.updatedAt)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={() => onEdit(item)}>
          Editar
        </button>
        <button type="button" className="btn-primary" onClick={() => onTest(item)} disabled={testing}>
          {testing ? "Testando..." : "Testar conexao"}
        </button>
      </div>
    </article>
  );
}
