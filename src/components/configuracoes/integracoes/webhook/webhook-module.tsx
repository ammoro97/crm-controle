"use client";

import { useEffect, useMemo, useState } from "react";
import { WebhookEntradaCard } from "./webhook-entrada-card";
import { WebhookSaidaCard } from "./webhook-saida-card";

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

type WebhookOutTestResponse = {
  success: boolean;
  message?: string;
  detail?: string | null;
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

export function WebhookModule() {
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

  const webhookInPath = "/api/api4com/webhook";
  const webhookInUrl = useMemo(() => {
    if (typeof window === "undefined") return webhookInPath;
    return `${window.location.origin}${webhookInPath}`;
  }, []);

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
        if (local?.secret) setWebhookOutSecret(local.secret);
        setWebhookOutConfigured(true);
        writeWebhookOutLocalConfig({ url: serverUrl, secret: local?.secret || webhookOutSecret });
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
    void loadWebhookOutConfig();
  }, []);

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookInUrl);
      setWebhookOutMessage("URL de entrada copiada para a area de transferencia.");
      setWebhookOutError(null);
    } catch {
      setWebhookOutError("Nao foi possivel copiar a URL de entrada.");
    }
  };

  const handleTestIncoming = () => {
    setWebhookInActive(true);
    setWebhookInLastEvent(new Date().toISOString());
    setWebhookOutMessage("Teste de recebimento realizado com sucesso.");
    setWebhookOutError(null);
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
        headers: { "Content-Type": "application/json" },
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
          return;
        }
        setWebhookOutError(data.error || "Nao foi possivel salvar webhook de saida.");
        return;
      }

      setWebhookOutConfigured(Boolean(data.config.enabled && data.config.url));
      writeWebhookOutLocalConfig({
        url: normalizedUrl || data.config.url || "",
        secret: webhookOutSecret,
      });
      setWebhookOutMessage(data.message || "Webhook de saida salvo com sucesso.");
    } catch {
      if (isValidHttpUrl(normalizedUrl)) {
        writeWebhookOutLocalConfig({ url: normalizedUrl, secret: webhookOutSecret });
        setWebhookOutConfigured(true);
        setWebhookOutMessage("Webhook salvo localmente neste navegador (modo compatibilidade).");
      } else {
        setWebhookOutError("Nao foi possivel salvar webhook de saida.");
      }
    } finally {
      setWebhookOutSaving(false);
    }
  };

  const handleSendWebhookOutTest = async () => {
    setWebhookOutTesting(true);
    setWebhookOutError(null);
    setWebhookOutMessage(null);

    try {
      const response = await fetch("/api/integrations/webhook-out/test", {
        method: "POST",
      });
      const data = (await response.json()) as WebhookOutTestResponse;
      if (!response.ok || !data.success) {
        setWebhookOutError(data.message || "Falha ao enviar teste.");
        return;
      }
      setWebhookOutMessage(data.message || "Teste enviado com sucesso.");
    } catch {
      setWebhookOutError("Nao foi possivel enviar teste de webhook.");
    } finally {
      setWebhookOutTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <WebhookEntradaCard
        endpoint={webhookInUrl}
        ativo={webhookInActive}
        ultimoEventoRecebido={webhookInLastEvent}
        onCopiarUrl={handleCopyWebhookUrl}
        onTestarRecebimento={handleTestIncoming}
      />

      <WebhookSaidaCard
        urlExterna={webhookOutUrl}
        metodoHttp="POST"
        segredo={webhookOutSecret}
        configurado={webhookOutConfigured}
        loading={webhookOutLoading}
        saving={webhookOutSaving}
        testing={webhookOutTesting}
        mensagem={webhookOutMessage}
        erro={webhookOutError}
        onUrlChange={setWebhookOutUrl}
        onSegredoChange={setWebhookOutSecret}
        onSalvar={() => void handleSaveWebhookOut()}
        onEnviarTeste={() => void handleSendWebhookOutTest()}
      />
    </div>
  );
}
