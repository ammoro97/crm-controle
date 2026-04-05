"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { StatusIntegracao } from "@/types/integrations";

export type Api4RamalFormMode = "create" | "edit";

export type Api4RamalFormValues = {
  id?: string;
  nome: string;
  ramal: string;
  gateway: string;
  token: string;
  status: StatusIntegracao;
  responsavelId: string;
  setAsPrimary: boolean;
};

export type Api4RamalResponsavelOption = {
  id: string;
  nome: string;
  emailLogin: string | null;
  authLinked: boolean;
};

export type Api4TemplateView = {
  baseIntegrationId: string | null;
  nomeBase: string;
  gateway: string;
  hasToken: boolean;
  tokenMasked: string;
};

type Api4RamalFormProps = {
  open: boolean;
  mode: Api4RamalFormMode;
  saving: boolean;
  initialValues: Api4RamalFormValues;
  template: Api4TemplateView | null;
  responsaveis: Api4RamalResponsavelOption[];
  onClose: () => void;
  onSubmit: (values: Api4RamalFormValues) => void;
};

function normalizeText(value: string): string {
  return String(value || "").trim();
}

export function Api4RamalForm({
  open,
  mode,
  saving,
  initialValues,
  template,
  responsaveis,
  onClose,
  onSubmit,
}: Api4RamalFormProps) {
  const [values, setValues] = useState<Api4RamalFormValues>(initialValues);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setShowToken(false);
    setError(null);
  }, [open, initialValues]);

  const title = mode === "create" ? "Adicionar novo ramal" : "Editar ramal";

  const helperText = useMemo(() => {
    if (mode === "edit") {
      return "Token vazio no edit preserva o token atual.";
    }
    if (template?.hasToken) {
      return "Formulario iniciado com base na configuracao atual da API4.";
    }
    return "Preencha token, gateway e ramal para criar a conexao.";
  }, [mode, template?.hasToken]);

  const handleSubmit = () => {
    const nome = normalizeText(values.nome);
    const ramal = normalizeText(values.ramal);
    const gateway = normalizeText(values.gateway);
    const token = normalizeText(values.token);

    if (!ramal) {
      setError("Informe o ramal para continuar.");
      return;
    }

    if (!nome) {
      setError("Informe o nome da integracao.");
      return;
    }

    if (!gateway && !(mode === "create" && template?.gateway)) {
      setError("Informe o gateway da API4.");
      return;
    }

    if (mode === "create" && !token && !template?.hasToken) {
      setError("Informe o token da API4 para cadastrar o primeiro ramal.");
      return;
    }

    setError(null);
    onSubmit({
      ...values,
      nome,
      ramal,
      gateway,
      token,
      responsavelId: normalizeText(values.responsavelId),
    });
  };

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-slate-900/50 p-3 text-xs text-slate-300">
          <p>{helperText}</p>
          {template ? (
            <p className="mt-2 text-slate-400">
              Base atual: <span className="text-slate-200">{template.nomeBase}</span> | Gateway base:{" "}
              <span className="text-slate-200">{template.gateway || "-"}</span> | Token base:{" "}
              <span className="text-slate-200">{template.tokenMasked}</span>
            </p>
          ) : null}
        </div>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Nome da integracao
          <input
            className="field mt-1"
            value={values.nome}
            onChange={(event) => setValues((prev) => ({ ...prev, nome: event.target.value }))}
            disabled={saving}
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Ramal
          <input
            className="field mt-1"
            value={values.ramal}
            onChange={(event) => setValues((prev) => ({ ...prev, ramal: event.target.value }))}
            disabled={saving}
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Gateway
          <input
            className="field mt-1"
            value={values.gateway}
            onChange={(event) => setValues((prev) => ({ ...prev, gateway: event.target.value }))}
            disabled={saving}
            placeholder={template?.gateway ? `Sugestao: ${template.gateway}` : ""}
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Token
          <div className="mt-1 flex gap-2">
            <input
              className="field"
              type={showToken ? "text" : "password"}
              value={values.token}
              onChange={(event) => setValues((prev) => ({ ...prev, token: event.target.value }))}
              disabled={saving}
              placeholder={mode === "edit" ? "Deixe vazio para manter o token atual" : "Cole o token"}
            />
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowToken((prev) => !prev)}>
              {showToken ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Status
          <select
            className="field mt-1"
            value={values.status}
            onChange={(event) => setValues((prev) => ({ ...prev, status: event.target.value as StatusIntegracao }))}
            disabled={saving}
          >
            <option value="inativo">Inativo</option>
            <option value="ativo">Ativo</option>
            <option value="erro">Erro</option>
          </select>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Responsavel vinculado ao ramal
          <select
            className="field mt-1"
            value={values.responsavelId}
            onChange={(event) => setValues((prev) => ({ ...prev, responsavelId: event.target.value }))}
            disabled={saving}
          >
            <option value="">Sem vinculo</option>
            {responsaveis.map((responsavel) => (
              <option key={responsavel.id} value={responsavel.id}>
                {responsavel.nome}
                {responsavel.emailLogin ? ` - ${responsavel.emailLogin}` : ""}
                {!responsavel.authLinked ? " (sem login vinculado)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={values.setAsPrimary}
            onChange={(event) => setValues((prev) => ({ ...prev, setAsPrimary: event.target.checked }))}
            disabled={saving}
          />
          Definir como ramal principal
        </label>

        {error ? <p className="text-xs text-rose-300">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : mode === "create" ? "Cadastrar ramal" : "Salvar alteracoes"}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
