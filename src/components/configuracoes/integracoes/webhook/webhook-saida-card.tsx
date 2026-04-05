import { ChangeEvent } from "react";

type WebhookSaidaCardProps = {
  urlExterna: string;
  metodoHttp: "POST";
  segredo: string;
  configurado: boolean;
  loading: boolean;
  saving: boolean;
  testing: boolean;
  mensagem: string | null;
  erro: string | null;
  onUrlChange: (value: string) => void;
  onSegredoChange: (value: string) => void;
  onSalvar: () => void;
  onEnviarTeste: () => void;
};

function getStatusClasses(active: boolean) {
  return active
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

export function WebhookSaidaCard({
  urlExterna,
  metodoHttp,
  segredo,
  configurado,
  loading,
  saving,
  testing,
  mensagem,
  erro,
  onUrlChange,
  onSegredoChange,
  onSalvar,
  onEnviarTeste,
}: WebhookSaidaCardProps) {
  const disabled = loading || saving;

  const handleUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUrlChange(event.target.value);
  };

  const handleSecretChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSegredoChange(event.target.value);
  };

  return (
    <article className="rounded-xl border border-border bg-slate-900/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Webhook de saida</h3>
          <p className="text-xs text-slate-400">Envio de eventos para sistemas externos</p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusClasses(configurado)}`}>
          {configurado ? "Configurado" : "Nao configurado"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          URL externa
          <input
            className="field mt-1"
            placeholder="https://seu-sistema.com/webhook"
            value={urlExterna}
            onChange={handleUrlChange}
            disabled={disabled}
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Metodo HTTP
          <select className="field mt-1" value={metodoHttp} disabled>
            <option value="POST">POST</option>
          </select>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Segredo / Token (opcional)
          <input
            className="field mt-1"
            placeholder="token-opcional"
            value={segredo}
            onChange={handleSecretChange}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={onSalvar} disabled={disabled}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onEnviarTeste}
          disabled={loading || testing || saving}
        >
          {testing ? "Enviando..." : "Enviar teste"}
        </button>
      </div>

      {loading ? <p className="mt-3 text-xs text-slate-400">Carregando configuracao...</p> : null}
      {mensagem ? <p className="mt-3 text-xs text-emerald-300">{mensagem}</p> : null}
      {erro ? <p className="mt-3 text-xs text-rose-300">{erro}</p> : null}
    </article>
  );
}
