"use client";

import { useEffect, useMemo, useState } from "react";
import { Api4RamaisList } from "./api4-ramais-list";
import {
  Api4RamalForm,
  type Api4RamalFormValues,
  type Api4RamalUserOption,
  type Api4TemplateView,
} from "./api4-ramal-form";
import type { Api4RamalView } from "./api4-ramal-card";

type Api4RamaisResponse = {
  success: boolean;
  message?: string;
  error?: string;
  items?: Api4RamalView[];
  template?: Api4TemplateView;
  users?: Api4RamalUserOption[];
};

const EMPTY_FORM_VALUES: Api4RamalFormValues = {
  nome: "",
  ramal: "",
  gateway: "",
  token: "",
  status: "inativo",
  userId: "",
  setAsPrimary: false,
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export function Api4Module() {
  const [items, setItems] = useState<Api4RamalView[]>([]);
  const [template, setTemplate] = useState<Api4TemplateView | null>(null);
  const [users, setUsers] = useState<Api4RamalUserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formValues, setFormValues] = useState<Api4RamalFormValues>(EMPTY_FORM_VALUES);

  const hasRamais = useMemo(() => items.length > 0, [items.length]);

  const loadRamais = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/api4com/ramais", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as Api4RamaisResponse;
      if (!response.ok || !data.success) {
        setError(data.error || "Nao foi possivel carregar ramais da API4.");
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTemplate(data.template || null);
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setError("Nao foi possivel carregar ramais da API4.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRamais();
  }, []);

  const openCreate = () => {
    setFormMode("create");
    setFormValues({
      ...EMPTY_FORM_VALUES,
      nome: template?.nomeBase ? `${template.nomeBase} - novo ramal` : "",
      gateway: template?.gateway || "",
      status: "inativo",
      setAsPrimary: !hasRamais,
    });
    setFormOpen(true);
    setMessage(null);
    setError(null);
  };

  const openEdit = (item: Api4RamalView) => {
    setFormMode("edit");
    setFormValues({
      id: item.id,
      nome: item.nome,
      ramal: item.ramal,
      gateway: item.gateway,
      token: "",
      status: item.status,
      userId: item.userId || "",
      setAsPrimary: item.isPrimary,
    });
    setFormOpen(true);
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (values: Api4RamalFormValues) => {
    setSaving(true);
    setError(null);
    setMessage(null);

    const endpoint = "/api/integrations/api4com/ramais";
    const method = formMode === "create" ? "POST" : "PUT";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: values.id,
          nome: values.nome,
          ramal: values.ramal,
          gateway: values.gateway,
          token: values.token,
          status: values.status,
          userId: values.userId || null,
          setAsPrimary: values.setAsPrimary,
          baseIntegrationId: template?.baseIntegrationId || null,
        }),
      });
      const data = (await response.json()) as Api4RamaisResponse;
      if (!response.ok || !data.success) {
        setError(data.error || "Nao foi possivel salvar o ramal.");
        return;
      }

      setItems(Array.isArray(data.items) ? data.items : []);
      setTemplate(data.template || null);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setMessage(data.message || "Ramal salvo com sucesso.");
      setFormOpen(false);
    } catch {
      setError("Nao foi possivel salvar o ramal.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (item: Api4RamalView) => {
    setTestingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/api4com/ramais/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = (await response.json()) as Api4RamaisResponse;
      if (!response.ok || !data.success) {
        setError(data.message || "Nao foi possivel testar a conexao do ramal.");
        if (Array.isArray(data.items)) setItems(data.items);
        return;
      }

      if (Array.isArray(data.items)) setItems(data.items);
      setMessage(data.message || "Conexao testada com sucesso.");
    } catch {
      setError("Nao foi possivel testar a conexao do ramal.");
    } finally {
      setTestingId(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Ramais cadastrados</h3>
              <p className="mt-1 text-xs text-slate-400">
                Cada ramal e uma conexao independente. O token e gateway podem ser reaproveitados.
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={openCreate} disabled={loading}>
              Adicionar novo ramal
            </button>
          </div>

          <div className="mt-4">
            <Api4RamaisList
              items={items}
              loading={loading}
              testingId={testingId}
              onEdit={openEdit}
              onTest={(itemToTest) => void handleTest(itemToTest)}
            />
          </div>
        </div>

        {message ? <p className="text-xs text-emerald-300">{message}</p> : null}
        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      </div>

      <Api4RamalForm
        open={formOpen}
        mode={formMode}
        saving={saving}
        initialValues={formValues}
        template={template}
        users={users}
        onClose={() => setFormOpen(false)}
        onSubmit={(nextValues) => void handleSubmit(nextValues)}
      />
    </>
  );
}
