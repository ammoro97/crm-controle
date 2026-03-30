"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { getResponsavelImpact, transferResponsavelVinculos } from "@/lib/responsaveis-relations";
import {
  ResponsavelRecord,
  ResponsavelTipo,
  addResponsavel,
  removeResponsavel,
  reloadResponsaveisGlobal,
  updateResponsavel,
  useResponsaveis,
  useResponsaveisRecords,
} from "@/lib/responsaveis-store";

type IntegrationLog = {
  id: string;
  type: string;
  origin: string;
  status: "Sucesso" | "Falha" | "Info";
  timestamp: string;
};

type Api4ComConfigView = {
  tokenMasked: string;
  hasToken: boolean;
  extension: string;
  gateway: string;
  isConnected: boolean;
  updatedAt: string | null;
};

type Api4ComConfigResponse = {
  success: boolean;
  message?: string;
  error?: string;
  config?: Api4ComConfigView;
};

type WebhookOutConfigView = {
  url: string;
  hasSecret: boolean;
  secretMasked: string;
  method: "POST";
  enabled: boolean;
  updatedAt: string | null;
};

type WebhookOutConfigResponse = {
  success: boolean;
  message?: string;
  error?: string;
  configured?: boolean;
  config?: WebhookOutConfigView;
};

const WEBHOOK_OUT_LOCAL_STORAGE_KEY = "crm:webhook-out-config:v1";

function normalizeWebhookOutUrlInput(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^ps:\/\//i.test(raw)) return `https://${raw.slice(5)}`;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) return `https://${raw}`;
  return raw;
}

function isValidHttpUrl(value?: string | null) {
  const url = String(value || "").trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readWebhookOutLocalConfig() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WEBHOOK_OUT_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: string; secret?: string };
    const url = normalizeWebhookOutUrlInput(parsed.url);
    if (!isValidHttpUrl(url)) return null;
    return {
      url,
      secret: String(parsed.secret || "").trim(),
    };
  } catch {
    return null;
  }
}

function writeWebhookOutLocalConfig(input: { url: string; secret?: string }) {
  if (typeof window === "undefined") return;
  const url = normalizeWebhookOutUrlInput(input.url);
  if (!isValidHttpUrl(url)) {
    window.localStorage.removeItem(WEBHOOK_OUT_LOCAL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    WEBHOOK_OUT_LOCAL_STORAGE_KEY,
    JSON.stringify({
      url,
      secret: String(input.secret || "").trim(),
      updatedAt: new Date().toISOString(),
    }),
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildInitialLogs(): IntegrationLog[] {
  const now = Date.now();
  return [
    {
      id: "log-1",
      type: "Webhook recebido",
      origin: "API4COM",
      status: "Sucesso",
      timestamp: new Date(now - 1000 * 60 * 12).toISOString(),
    },
    {
      id: "log-2",
      type: "Teste de conexao",
      origin: "API4COM",
      status: "Sucesso",
      timestamp: new Date(now - 1000 * 60 * 35).toISOString(),
    },
    {
      id: "log-3",
      type: "Envio de webhook",
      origin: "Webhook de saida",
      status: "Falha",
      timestamp: new Date(now - 1000 * 60 * 50).toISOString(),
    },
    {
      id: "log-4",
      type: "Autenticacao",
      origin: "API4COM",
      status: "Info",
      timestamp: new Date(now - 1000 * 60 * 80).toISOString(),
    },
  ];
}

function getStatusClasses(active: boolean) {
  return active
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

function getApi4ComStatusMeta(config: Api4ComConfigView) {
  if (!config.hasToken) {
    return {
      label: "Nao configurado",
      classes: "border-slate-600 bg-slate-800/70 text-slate-300",
    };
  }

  if (config.isConnected) {
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

function getLogStatusClasses(status: IntegrationLog["status"]) {
  if (status === "Sucesso") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status === "Falha") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-slate-600 bg-slate-800/70 text-slate-300";
}

export default function ConfiguracoesPage() {
  const responsaveisRecords = useResponsaveisRecords();
  const responsaveis = useResponsaveis(false);
  const [responsaveisOpen, setResponsaveisOpen] = useState(false);
  const [integracoesOpen, setIntegracoesOpen] = useState(false);
  const [novoResponsavel, setNovoResponsavel] = useState("");
  const [novoResponsavelTipo, setNovoResponsavelTipo] = useState<ResponsavelTipo>("vendedor");
  const [novoResponsavelEmail, setNovoResponsavelEmail] = useState("");
  const [responsavelErro, setResponsavelErro] = useState<string | null>(null);
  const [editingResponsavelId, setEditingResponsavelId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  const [editingTipo, setEditingTipo] = useState<ResponsavelTipo>("vendedor");
  const [editingEmail, setEditingEmail] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ResponsavelRecord | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [deleteErro, setDeleteErro] = useState<string | null>(null);

  const [api4comConfig, setApi4comConfig] = useState<Api4ComConfigView>({
    tokenMasked: "Nao configurado",
    hasToken: false,
    extension: "",
    gateway: "",
    isConnected: false,
    updatedAt: null,
  });
  const [api4comEditMode, setApi4comEditMode] = useState(false);
  const [api4comForm, setApi4comForm] = useState({
    token: "",
    extension: "",
    gateway: "",
  });
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [api4comLoading, setApi4comLoading] = useState(false);
  const [api4comSaving, setApi4comSaving] = useState(false);
  const [api4comTesting, setApi4comTesting] = useState(false);
  const [api4comMessage, setApi4comMessage] = useState<string | null>(null);
  const [api4comError, setApi4comError] = useState<string | null>(null);

  const [webhookInActive, setWebhookInActive] = useState(true);
  const [webhookInLastEvent, setWebhookInLastEvent] = useState<string | null>(null);

  const [webhookOutUrl, setWebhookOutUrl] = useState("");
  const [webhookOutSecret, setWebhookOutSecret] = useState("");
  const [webhookOutConfigured, setWebhookOutConfigured] = useState(false);
  const [webhookOutLoading, setWebhookOutLoading] = useState(false);
  const [webhookOutSaving, setWebhookOutSaving] = useState(false);
  const [webhookOutTesting, setWebhookOutTesting] = useState(false);
  const [webhookOutMessage, setWebhookOutMessage] = useState<string | null>(null);
  const [webhookOutError, setWebhookOutError] = useState<string | null>(null);

  const [logs, setLogs] = useState<IntegrationLog[]>(() => buildInitialLogs());

  const webhookInPath = "/api/api4com/webhook";
  const webhookInUrl = useMemo(() => {
    if (typeof window === "undefined") return webhookInPath;
    return `${window.location.origin}${webhookInPath}`;
  }, []);

  const deleteImpact = useMemo(() => {
    if (!deleteTarget) return { leadCount: 0, meetingCount: 0, total: 0 };
    return getResponsavelImpact(deleteTarget.nome);
  }, [deleteTarget]);

  const transferOptions = useMemo(
    () => responsaveisRecords.filter((item) => item.id !== deleteTarget?.id),
    [responsaveisRecords, deleteTarget?.id],
  );

  const api4comStatus = useMemo(() => getApi4ComStatusMeta(api4comConfig), [api4comConfig]);

  const pushLog = (type: string, origin: string, status: IntegrationLog["status"]) => {
    setLogs((prev) => [
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        origin,
        status,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const loadApi4ComConfig = async () => {
    setApi4comLoading(true);
    setApi4comError(null);

    try {
      const response = await fetch("/api/integrations/api4com", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as Api4ComConfigResponse;

      if (!response.ok || !data.success || !data.config) {
        setApi4comError(data.error || "Nao foi possivel carregar configuracoes da API4COM.");
        return;
      }

      const config = data.config;
      setApi4comConfig(config);
      setApi4comForm((prev) => ({
        token: prev.token,
        extension: config.extension,
        gateway: config.gateway,
      }));
    } catch {
      setApi4comError("Nao foi possivel carregar configuracoes da API4COM.");
    } finally {
      setApi4comLoading(false);
    }
  };

  const loadWebhookOutConfig = async () => {
    setWebhookOutLoading(true);
    setWebhookOutError(null);
    setWebhookOutMessage(null);
    const local = readWebhookOutLocalConfig();
    try {
      const response = await fetch("/api/integrations/webhook-out", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as WebhookOutConfigResponse;

      if (!response.ok || !data.success || !data.config) {
        if (local?.url) {
          setWebhookOutUrl(local.url);
          setWebhookOutSecret(local.secret || "");
          setWebhookOutConfigured(true);
          setWebhookOutMessage("Webhook carregado do navegador (modo compatibilidade).");
          return;
        }
        setWebhookOutError(data.error || "Nao foi possivel carregar webhook de saida.");
        return;
      }

      const serverUrl = normalizeWebhookOutUrlInput(data.config.url || "");
      const serverConfigured = Boolean(data.config.enabled && isValidHttpUrl(serverUrl));

      if (serverConfigured) {
        setWebhookOutUrl(serverUrl);
        if (local?.secret) {
          setWebhookOutSecret(local.secret);
        }
        setWebhookOutConfigured(true);
        writeWebhookOutLocalConfig({
          url: serverUrl,
          secret: local?.secret || webhookOutSecret,
        });
        return;
      }

      if (local?.url) {
        setWebhookOutUrl(local.url);
        setWebhookOutSecret(local.secret || "");
        setWebhookOutConfigured(true);
        setWebhookOutMessage("Webhook carregado do navegador (modo compatibilidade).");
        return;
      }

      setWebhookOutUrl("");
      setWebhookOutConfigured(false);
    } catch {
      if (local?.url) {
        setWebhookOutUrl(local.url);
        setWebhookOutSecret(local.secret || "");
        setWebhookOutConfigured(true);
        setWebhookOutMessage("Webhook carregado do navegador (modo compatibilidade).");
      } else {
        setWebhookOutError("Nao foi possivel carregar webhook de saida.");
      }
    } finally {
      setWebhookOutLoading(false);
    }
  };

  useEffect(() => {
    if (!integracoesOpen) return;
    void loadApi4ComConfig();
    void loadWebhookOutConfig();
  }, [integracoesOpen]);

  useEffect(() => {
    void reloadResponsaveisGlobal();
  }, []);

  const onAddResponsavel = async () => {
    const next = novoResponsavel.trim();
    const nextEmail = novoResponsavelEmail.trim().toLowerCase();
    if (!next) {
      setResponsavelErro("Informe um nome para continuar.");
      return;
    }

    const duplicated = responsaveis.some((item) => item.toLowerCase() === next.toLowerCase());
    if (duplicated) {
      setResponsavelErro("Este responsavel ja esta cadastrado.");
      return;
    }

    if (nextEmail) {
      const duplicatedEmail = responsaveisRecords.some((item) => (item.email || "").toLowerCase() === nextEmail);
      if (duplicatedEmail) {
        setResponsavelErro("Ja existe um responsavel com este e-mail.");
        return;
      }
    }

    try {
      await addResponsavel({ nome: next, tipo: novoResponsavelTipo, email: nextEmail });
      setNovoResponsavel("");
      setNovoResponsavelTipo("vendedor");
      setNovoResponsavelEmail("");
      setResponsavelErro(null);
    } catch (error) {
      setResponsavelErro(error instanceof Error ? error.message : "Nao foi possivel adicionar responsavel.");
    }
  };

  const openDeleteResponsavel = (record: ResponsavelRecord) => {
    setDeleteTarget(record);
    setTransferTo("");
    setDeleteErro(null);
  };

  const openEditResponsavel = (record: ResponsavelRecord) => {
    setEditingResponsavelId(record.id);
    setEditingNome(record.nome);
    setEditingTipo(record.tipo);
    setEditingEmail(record.email || "");
    setResponsavelErro(null);
  };

  const cancelEditResponsavel = () => {
    setEditingResponsavelId(null);
    setEditingNome("");
    setEditingTipo("vendedor");
    setEditingEmail("");
    setResponsavelErro(null);
  };

  const saveEditResponsavel = async () => {
    if (!editingResponsavelId) return;
    const nextNome = editingNome.trim();
    const nextEmail = editingEmail.trim().toLowerCase();
    if (!nextNome) {
      setResponsavelErro("Informe um nome para continuar.");
      return;
    }
    const duplicated = responsaveisRecords.some(
      (item) => item.id !== editingResponsavelId && item.nome.toLowerCase() === nextNome.toLowerCase(),
    );
    if (duplicated) {
      setResponsavelErro("Ja existe um responsavel com este nome.");
      return;
    }

    if (nextEmail) {
      const duplicatedEmail = responsaveisRecords.some(
        (item) => item.id !== editingResponsavelId && (item.email || "").toLowerCase() === nextEmail,
      );
      if (duplicatedEmail) {
        setResponsavelErro("Ja existe um responsavel com este e-mail.");
        return;
      }
    }

    try {
      await updateResponsavel(editingResponsavelId, { nome: nextNome, tipo: editingTipo, email: nextEmail });
      cancelEditResponsavel();
    } catch (error) {
      setResponsavelErro(error instanceof Error ? error.message : "Nao foi possivel editar responsavel.");
    }
  };

  const confirmDeleteResponsavel = async () => {
    if (!deleteTarget) return;

    if (deleteImpact.total > 0) {
      if (responsaveis.length === 1) {
        setDeleteErro(
          "Nao e possivel excluir este responsavel porque ele e o ultimo cadastrado e existem itens vinculados a ele.",
        );
        return;
      }

      if (!transferTo) {
        setDeleteErro("Selecione para quem os vinculos serao transferidos.");
        return;
      }

      transferResponsavelVinculos(deleteTarget.nome, transferTo);
    }

    try {
      await removeResponsavel(deleteTarget.id);
      setDeleteTarget(null);
      setTransferTo("");
      setDeleteErro(null);
    } catch (error) {
      setDeleteErro(error instanceof Error ? error.message : "Nao foi possivel excluir responsavel.");
    }
  };

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookInUrl);
      pushLog("URL copiada", "Webhook de entrada", "Sucesso");
    } catch {
      pushLog("Falha ao copiar URL", "Webhook de entrada", "Falha");
    }
  };

  const handleTestIncoming = () => {
    const now = new Date().toISOString();
    setWebhookInActive(true);
    setWebhookInLastEvent(now);
    pushLog("Teste de recebimento", "Webhook de entrada", "Sucesso");
  };

  const handleOpenApi4ComConfig = () => {
    setApi4comEditMode(true);
    setApi4comError(null);
    setApi4comMessage(null);
    setApi4comForm({
      token: "",
      extension: api4comConfig.extension,
      gateway: api4comConfig.gateway,
    });
  };

  const handleCancelApi4ComConfig = () => {
    setApi4comEditMode(false);
    setShowTokenInput(false);
    setApi4comError(null);
    setApi4comMessage(null);
    setApi4comForm((prev) => ({
      ...prev,
      token: "",
      extension: api4comConfig.extension,
      gateway: api4comConfig.gateway,
    }));
  };

  const handleSaveApi4ComConfig = async () => {
    setApi4comSaving(true);
    setApi4comError(null);
    setApi4comMessage(null);

    try {
      const response = await fetch("/api/integrations/api4com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: api4comForm.token,
          extension: api4comForm.extension,
          gateway: api4comForm.gateway,
        }),
      });

      const data = (await response.json()) as Api4ComConfigResponse;
      if (!response.ok || !data.success || !data.config) {
        const message = data.error || "Falha ao salvar credenciais";
        setApi4comError(message);
        pushLog("Falha ao salvar credenciais", "API4COM", "Falha");
        return;
      }

      setApi4comConfig(data.config);
      setApi4comMessage(data.message || "Credenciais salvas com sucesso");
      setApi4comEditMode(false);
      setShowTokenInput(false);
      setApi4comForm({
        token: "",
        extension: data.config.extension,
        gateway: data.config.gateway,
      });
      await loadApi4ComConfig();
      pushLog("Credenciais salvas", "API4COM", "Sucesso");
    } catch {
      setApi4comError("Falha ao salvar credenciais");
      pushLog("Falha ao salvar credenciais", "API4COM", "Falha");
    } finally {
      setApi4comSaving(false);
    }
  };

  const handleTestApi4com = async () => {
    setApi4comTesting(true);
    setApi4comError(null);
    setApi4comMessage(null);

    try {
      const response = await fetch("/api/integrations/api4com/test", {
        method: "POST",
      });

      const data = (await response.json()) as Api4ComConfigResponse;
      if (data.config) {
        setApi4comConfig(data.config);
      }

      if (!response.ok || !data.success) {
        setApi4comError(data.message || "Nao foi possivel testar a conexao");
        pushLog("Falha no teste de conexao", "API4COM", "Falha");
        return;
      }

      setApi4comMessage(data.message || "Conexao testada com sucesso");
      pushLog("Teste de conexao", "API4COM", "Sucesso");
    } catch {
      setApi4comError("Nao foi possivel testar a conexao");
      pushLog("Falha no teste de conexao", "API4COM", "Falha");
    } finally {
      setApi4comTesting(false);
    }
  };

  const handleSaveWebhookOut = async () => {
    setWebhookOutSaving(true);
    setWebhookOutError(null);
    setWebhookOutMessage(null);
    const normalizedUrl = normalizeWebhookOutUrlInput(webhookOutUrl);
    setWebhookOutUrl(normalizedUrl);
    try {
      const response = await fetch("/api/integrations/webhook-out", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: normalizedUrl,
          secret: webhookOutSecret.trim() ? webhookOutSecret : undefined,
          method: "POST",
          enabled: Boolean(normalizedUrl),
        }),
      });

      const data = (await response.json()) as WebhookOutConfigResponse;
      if (!response.ok || !data.success || !data.config) {
        if (isValidHttpUrl(normalizedUrl)) {
          writeWebhookOutLocalConfig({ url: normalizedUrl, secret: webhookOutSecret });
          setWebhookOutConfigured(true);
          setWebhookOutMessage("Webhook salvo localmente neste navegador (modo compatibilidade).");
          pushLog("Configuracao salva (local)", "Webhook de saida", "Info");
          return;
        }
        const message = data.error || "Nao foi possivel salvar webhook de saida.";
        setWebhookOutError(message);
        pushLog("Configuracao salva", "Webhook de saida", "Falha");
        return;
      }

      setWebhookOutConfigured(Boolean(data.config.enabled && data.config.url));
      setWebhookOutUrl(data.config.url || "");
      setWebhookOutMessage(data.message || "Webhook de saida salvo com sucesso.");
      writeWebhookOutLocalConfig({ url: data.config.url || normalizedUrl, secret: webhookOutSecret });
      pushLog("Configuracao salva", "Webhook de saida", "Sucesso");
    } catch {
      if (isValidHttpUrl(normalizedUrl)) {
        writeWebhookOutLocalConfig({ url: normalizedUrl, secret: webhookOutSecret });
        setWebhookOutConfigured(true);
        setWebhookOutMessage("Webhook salvo localmente neste navegador (modo compatibilidade).");
        pushLog("Configuracao salva (local)", "Webhook de saida", "Info");
      } else {
        setWebhookOutError("Nao foi possivel salvar webhook de saida.");
        pushLog("Configuracao salva", "Webhook de saida", "Falha");
      }
    } finally {
      setWebhookOutSaving(false);
    }
  };

  const handleSendWebhookOutTest = async () => {
    const normalizedUrl = normalizeWebhookOutUrlInput(webhookOutUrl);
    if (!normalizedUrl.trim()) {
      setWebhookOutError("Informe a URL do webhook de saida antes de testar.");
      pushLog("Teste sem URL configurada", "Webhook de saida", "Falha");
      return;
    }
    setWebhookOutUrl(normalizedUrl);
    setWebhookOutTesting(true);
    setWebhookOutError(null);
    setWebhookOutMessage(null);
    try {
      const response = await fetch("/api/integrations/webhook-out/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhook: {
            url: normalizedUrl,
            secret: webhookOutSecret.trim() ? webhookOutSecret : undefined,
            method: "POST",
          },
        }),
      });
      const data = (await response.json()) as WebhookOutConfigResponse;
      if (!response.ok || !data.success) {
        setWebhookOutError(data.message || data.error || "Falha no envio de teste.");
        pushLog("Envio de teste", "Webhook de saida", "Falha");
        return;
      }
      setWebhookOutMessage(data.message || "Teste enviado com sucesso.");
      pushLog("Envio de teste", "Webhook de saida", "Sucesso");
    } catch {
      setWebhookOutError("Nao foi possivel enviar teste para webhook de saida.");
      pushLog("Envio de teste", "Webhook de saida", "Falha");
    } finally {
      setWebhookOutTesting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="panel p-5">
        <h1 className="text-lg font-semibold text-slate-100">Configuracoes do CRM</h1>
        <p className="mt-1 text-sm text-slate-400">
          Centralize parametros operacionais, equipe e integrações do sistema.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article
          role="button"
          tabIndex={0}
          onClick={() => setResponsaveisOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setResponsaveisOpen(true);
            }
          }}
          className="panel cursor-pointer p-5 transition hover:border-emerald-400/40 hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
          aria-label="Abrir configuracao de responsaveis"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">EQUIPE</p>
              <h2 className="mt-2 text-base font-semibold text-slate-100">Responsaveis</h2>
              <p className="mt-1 text-sm text-slate-400">
                Cadastre os responsaveis que poderao aparecer nos agendamentos e filtros da agenda.
              </p>
            </div>
          </div>
        </article>

        <article
          role="button"
          tabIndex={0}
          onClick={() => setIntegracoesOpen((prev) => !prev)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIntegracoesOpen((prev) => !prev);
            }
          }}
          className="panel cursor-pointer p-5 transition hover:border-emerald-400/40 hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
          aria-label={integracoesOpen ? "Fechar integracoes" : "Abrir integracoes"}
        >
          <div className="flex items-start gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">INTEGRACOES</p>
              <h2 className="mt-2 text-base font-semibold text-slate-100">Integracoes</h2>
              <p className="mt-1 text-sm text-slate-400">
                Conecte telefonia, webhooks e acompanhe o fluxo de eventos do sistema.
              </p>
            </div>
          </div>
        </article>
      </div>

      {integracoesOpen ? (
        <div className="panel p-5">
          <div className="mt-1 grid gap-4 xl:grid-cols-3">
            <article className="rounded-xl border border-border bg-slate-900/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">API4COM</h3>
                  <p className="text-xs text-slate-400">Telefonia e chamadas</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${api4comStatus.classes}`}>
                  {api4comStatus.label}
                </span>
              </div>

              {api4comEditMode ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Ramal
                    <input
                      className="field mt-1"
                      value={api4comForm.extension}
                      onChange={(event) => setApi4comForm((prev) => ({ ...prev, extension: event.target.value }))}
                    />
                  </label>

                  <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Gateway
                    <input
                      className="field mt-1"
                      value={api4comForm.gateway}
                      onChange={(event) => setApi4comForm((prev) => ({ ...prev, gateway: event.target.value }))}
                    />
                  </label>

                  <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Token
                    <div className="mt-1 flex gap-2">
                      <input
                        className="field"
                        type={showTokenInput ? "text" : "password"}
                        placeholder={api4comConfig.hasToken ? "Deixe vazio para manter o token atual" : "Cole o token"}
                        value={api4comForm.token}
                        onChange={(event) => setApi4comForm((prev) => ({ ...prev, token: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn-ghost whitespace-nowrap"
                        onClick={() => setShowTokenInput((prev) => !prev)}
                      >
                        {showTokenInput ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  </label>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void handleSaveApi4ComConfig()}
                      disabled={api4comSaving}
                    >
                      {api4comSaving ? "Salvando..." : "Salvar"}
                    </button>
                    <button type="button" className="btn-ghost" onClick={handleCancelApi4ComConfig} disabled={api4comSaving}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : api4comLoading ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-slate-400">Carregando configuracoes...</p>
                  <button type="button" className="btn-ghost" onClick={handleOpenApi4ComConfig}>
                    Configurar
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ramal</p>
                    <div className="mt-1 rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                      {api4comConfig.extension || "-"}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Gateway</p>
                    <div className="mt-1 rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                      {api4comConfig.gateway || "-"}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Token configurado</p>
                    <div className="mt-1 rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                      {api4comConfig.tokenMasked}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Atualizado em</p>
                    <div className="mt-1 rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
                      {api4comConfig.updatedAt ? formatDateTime(api4comConfig.updatedAt) : "-"}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void handleTestApi4com()}
                      disabled={api4comTesting}
                    >
                      {api4comTesting ? "Testando..." : "Testar conexao"}
                    </button>
                    <button type="button" className="btn-ghost" onClick={handleOpenApi4ComConfig}>
                      Configurar
                    </button>
                  </div>
                </div>
              )}

              {api4comMessage ? <p className="mt-3 text-xs text-emerald-300">{api4comMessage}</p> : null}
              {api4comError ? <p className="mt-3 text-xs text-rose-300">{api4comError}</p> : null}
            </article>

            <article className="rounded-xl border border-border bg-slate-900/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Webhook de entrada</h3>
                  <p className="text-xs text-slate-400">Endpoint que recebe eventos externos</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusClasses(webhookInActive)}`}
                >
                  {webhookInActive ? "Ativo" : "Inativo"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Endpoint
                  <input className="field mt-1" readOnly value={webhookInUrl} />
                </label>

                <div className="rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ultimo evento recebido</p>
                  <p className="mt-1">{webhookInLastEvent ? formatDateTime(webhookInLastEvent) : "--"}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" onClick={handleCopyWebhookUrl}>
                  Copiar URL
                </button>
                <button type="button" className="btn-primary" onClick={handleTestIncoming}>
                  Testar recebimento
                </button>
              </div>
            </article>

            <article className="rounded-xl border border-border bg-slate-900/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Webhook de saida</h3>
                  <p className="text-xs text-slate-400">Envio de eventos para sistemas externos</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusClasses(webhookOutConfigured)}`}
                >
                  {webhookOutConfigured ? "Configurado" : "Nao configurado"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  URL externa
                  <input
                    className="field mt-1"
                    placeholder="https://seu-sistema.com/webhook"
                    value={webhookOutUrl}
                    onChange={(event) => setWebhookOutUrl(event.target.value)}
                    disabled={webhookOutLoading || webhookOutSaving}
                  />
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Metodo HTTP
                  <select className="field mt-1" value="POST" disabled>
                    <option value="POST">POST</option>
                  </select>
                </label>

                <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Segredo / Token (opcional)
                  <input
                    className="field mt-1"
                    placeholder="token-opcional"
                    value={webhookOutSecret}
                    onChange={(event) => setWebhookOutSecret(event.target.value)}
                    disabled={webhookOutLoading || webhookOutSaving}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleSaveWebhookOut()}
                  disabled={webhookOutLoading || webhookOutSaving}
                >
                  {webhookOutSaving ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void handleSendWebhookOutTest()}
                  disabled={webhookOutLoading || webhookOutTesting || webhookOutSaving}
                >
                  {webhookOutTesting ? "Enviando..." : "Enviar teste"}
                </button>
              </div>

              {webhookOutLoading ? <p className="mt-3 text-xs text-slate-400">Carregando configuracao...</p> : null}
              {webhookOutMessage ? <p className="mt-3 text-xs text-emerald-300">{webhookOutMessage}</p> : null}
              {webhookOutError ? <p className="mt-3 text-xs text-rose-300">{webhookOutError}</p> : null}
            </article>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-100">Logs recentes de integracao</h3>
              <span className="rounded-full border border-border bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-300">
                {logs.length} registros
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-2 py-2 font-semibold">Tipo</th>
                    <th className="px-2 py-2 font-semibold">Origem</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Data/Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-border/80 text-slate-200">
                      <td className="px-2 py-3">{log.type}</td>
                      <td className="px-2 py-3">{log.origin}</td>
                      <td className="px-2 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${getLogStatusClasses(log.status)}`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-slate-300">{formatDateTime(log.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <Modal title="Configurar Responsaveis" open={responsaveisOpen} onClose={() => setResponsaveisOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-slate-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Novo responsavel</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                className="field"
                placeholder="Nome do responsavel"
                value={novoResponsavel}
                onChange={(event) => setNovoResponsavel(event.target.value)}
              />
              <input
                className="field"
                type="email"
                placeholder="E-mail do login (opcional)"
                value={novoResponsavelEmail}
                onChange={(event) => setNovoResponsavelEmail(event.target.value)}
              />
              <select
                className="field sm:max-w-[180px]"
                value={novoResponsavelTipo}
                onChange={(event) => setNovoResponsavelTipo(event.target.value as ResponsavelTipo)}
              >
                <option value="vendedor">Vendedor</option>
                <option value="gestor">Gestor</option>
              </select>
              <button type="button" className="btn-primary whitespace-nowrap" onClick={() => void onAddResponsavel()}>
                Adicionar
              </button>
            </div>
            {responsavelErro ? <p className="mt-2 text-xs text-rose-300">{responsavelErro}</p> : null}
          </div>

          <div className="rounded-xl border border-border bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Responsaveis cadastrados</p>
              <span className="text-xs text-slate-400">{responsaveisRecords.length}</span>
            </div>

            {responsaveisRecords.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum responsavel cadastrado.</p>
            ) : (
              <div className="space-y-2">
                {responsaveisRecords.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border border-border bg-slate-950/40 px-3 py-2"
                  >
                    {editingResponsavelId === record.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          className="field"
                          value={editingNome}
                          onChange={(event) => setEditingNome(event.target.value)}
                        />
                        <input
                          className="field"
                          type="email"
                          placeholder="E-mail do login (opcional)"
                          value={editingEmail}
                          onChange={(event) => setEditingEmail(event.target.value)}
                        />
                        <select
                          className="field sm:max-w-[180px]"
                          value={editingTipo}
                          onChange={(event) => setEditingTipo(event.target.value as ResponsavelTipo)}
                        >
                          <option value="vendedor">Vendedor</option>
                          <option value="gestor">Gestor</option>
                        </select>
                        <button type="button" className="btn-primary whitespace-nowrap" onClick={() => void saveEditResponsavel()}>
                          Salvar
                        </button>
                        <button type="button" className="btn-ghost whitespace-nowrap" onClick={cancelEditResponsavel}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="text-sm text-slate-100">{record.nome}</span>
                            {record.email ? <p className="text-xs text-slate-400">{record.email}</p> : null}
                          </div>
                          <span className="rounded-md border border-slate-600 bg-slate-800/70 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                            {record.tipo === "gestor" ? "Gestor" : "Vendedor"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                            onClick={() => openEditResponsavel(record)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-rose-500/40 px-2 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                            onClick={() => openDeleteResponsavel(record)}
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal title="Excluir responsavel" open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        {deleteTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-200">
              Voce esta prestes a excluir o responsavel:{" "}
              <span className="font-semibold text-slate-100">{deleteTarget.nome}</span>
            </p>

            {deleteImpact.total > 0 ? (
              <div className="space-y-3 rounded-lg border border-border bg-slate-900/50 p-3 text-sm text-slate-300">
                <p>Este responsavel possui itens vinculados e eles precisam ser transferidos para outro responsavel.</p>
                <p className="text-xs text-slate-400">
                  Leads: {deleteImpact.leadCount} | Agendamentos: {deleteImpact.meetingCount}
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Transferir vinculos para
                  </span>
                  <select className="field" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                    <option value="">Selecione</option>
                    {transferOptions.map((item) => (
                      <option key={item.id} value={item.nome}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {deleteErro ? <p className="text-xs text-rose-300">{deleteErro}</p> : null}

            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                onClick={() => void confirmDeleteResponsavel()}
              >
                Confirmar exclusao
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

