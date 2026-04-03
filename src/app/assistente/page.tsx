"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type UiChatRole = "assistant" | "user";

type UiChatSource = "openai" | "fallback";

type UiChatMessage = {
  id: string;
  role: UiChatRole;
  content: string;
  source?: UiChatSource;
  createdAt: string;
};

type ApiConversationItem = {
  role: UiChatRole;
  content: string;
};

type AssistantChatResponse = {
  success: boolean;
  message?: string;
  source?: UiChatSource;
  error?: string;
};

const QUICK_PROMPTS = [
  "Mapeie os melhores horarios de ligacao por dia da semana e me diga onde estou perdendo oportunidade.",
  "Crie uma rotina para acompanhar semanalmente os horarios sem ligacoes e impacto em faturamento.",
  "Me traga 3 insights proativos que eu possa aplicar hoje no time comercial.",
];

function buildMessage(input: {
  role: UiChatRole;
  content: string;
  source?: UiChatSource;
}): UiChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: input.role,
    content: input.content,
    source: input.source,
    createdAt: new Date().toISOString(),
  };
}

function toApiConversation(messages: UiChatMessage[]): ApiConversationItem[] {
  return messages.slice(-12).map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

function formatTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function AssistentePage() {
  const [messages, setMessages] = useState<UiChatMessage[]>(() => [
    buildMessage({
      role: "assistant",
      source: "fallback",
      content:
        "Oi, eu sou seu Assistente do CRM. Eu posso analisar ligacoes, agenda, leads e metricas para gerar insights ativos. Se voce aprovar um insight, eu te ajudo a transformar em acompanhamento continuo.",
    }),
  ]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(
    () => !sending && String(inputValue || "").trim().length > 0,
    [inputValue, sending],
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, sending]);

  async function sendMessage(rawInput: string) {
    const content = String(rawInput || "").trim();
    if (!content || sending) return;

    const priorConversation = toApiConversation(messages);
    const userMessage = buildMessage({ role: "user", content });

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setErrorMessage(null);
    setSending(true);

    try {
      const response = await fetch("/api/assistente/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          conversation: priorConversation,
        }),
      });

      const data = (await response.json()) as AssistantChatResponse;
      if (!response.ok || !data.success || !data.message) {
        throw new Error(data.error || "Nao foi possivel obter resposta do assistente.");
      }

      setMessages((prev) => [
        ...prev,
        buildMessage({
          role: "assistant",
          content: data.message || "",
          source: data.source || "fallback",
        }),
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro desconhecido";
      setErrorMessage(detail);
      setMessages((prev) => [
        ...prev,
        buildMessage({
          role: "assistant",
          source: "fallback",
          content:
            "Nao consegui responder agora. Tente novamente em alguns segundos. Se o erro persistir, confira a configuracao da API do assistente.",
        }),
      ]);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(inputValue);
  }

  return (
    <section className="space-y-4">
      <header className="panel px-5 py-4">
        <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-300">Assistente Ativo</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">Janela do Assistente</h1>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          Converse com o assistente para investigar dados, receber insights proativos e transformar ideias em
          acompanhamento continuo.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="panel flex min-h-[66vh] flex-col overflow-hidden">
          <div
            ref={messagesContainerRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5"
          >
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <article
                  key={message.id}
                  className={`max-w-[92%] rounded-xl border px-3 py-2 text-sm shadow-sm md:max-w-[82%] ${
                    isUser
                      ? "ml-auto border-cyan-400/40 bg-cyan-500/15 text-cyan-50"
                      : "mr-auto border-border bg-slate-900/70 text-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em]">
                    <span className={isUser ? "text-cyan-200" : "text-slate-400"}>
                      {isUser ? "Voce" : "Assistente"}
                    </span>
                    <span className={isUser ? "text-cyan-200/80" : "text-slate-500"}>
                      {formatTimeLabel(message.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  {!isUser && message.source ? (
                    <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Fonte: {message.source === "openai" ? "API IA" : "Fallback local"}
                    </p>
                  ) : null}
                </article>
              );
            })}
            {sending ? (
              <article className="mr-auto max-w-[82%] rounded-xl border border-border bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Assistente</p>
                <p className="mt-2">Analisando dados do CRM e preparando recomendacoes...</p>
              </article>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="border-t border-border px-4 py-3 md:px-5">
            <textarea
              className="field min-h-24 resize-y"
              placeholder="Exemplo: Analise meu funil por horario e me proponha 3 acoes com estimativa de impacto."
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              disabled={sending}
            />
            {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
            <div className="mt-3 flex items-center justify-end">
              <button type="submit" className="btn-primary px-4" disabled={!canSend}>
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="panel p-4">
            <h2 className="text-sm font-semibold text-slate-100">Atalhos de insight</h2>
            <p className="mt-1 text-xs text-slate-400">
              Clique em um atalho para pedir uma analise com foco em acao.
            </p>
            <div className="mt-3 space-y-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="w-full rounded-lg border border-border bg-slate-900/70 px-3 py-2 text-left text-xs text-slate-200 transition hover:border-cyan-400/50 hover:bg-cyan-500/10"
                  onClick={() => void sendMessage(prompt)}
                  disabled={sending}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-semibold text-slate-100">Modo ativo</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Diga &quot;quero acompanhar isso&quot; para eu transformar o insight em monitor continuo.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
