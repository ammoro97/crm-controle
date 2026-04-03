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
    <section className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#3a3b45] bg-[#202123] shadow-panel">
      <header className="border-b border-[#3a3b45] px-4 py-3 md:px-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[#6de7ff]">Assistente GPT</p>
        <h1 className="mt-1 text-lg font-semibold text-slate-100 md:text-xl">Janela do Assistente</h1>
      </header>

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-[#202123]"
      >
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <article
              key={message.id}
              className={`border-b border-[#2b2c33] px-4 py-5 md:px-6 ${
                isUser ? "bg-[#2a2b32]" : "bg-[#202123]"
              }`}
            >
              <div className="mx-auto flex max-w-4xl gap-3">
                <div
                  className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isUser
                      ? "bg-[#0b6a88] text-cyan-50"
                      : "bg-[#3a3b45] text-slate-200"
                  }`}
                >
                  {isUser ? "U" : "AI"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em]">
                    <span className={isUser ? "text-cyan-200" : "text-slate-400"}>
                      {isUser ? "Voce" : "Assistente"}
                    </span>
                    <span className="text-slate-500">{formatTimeLabel(message.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-100">{message.content}</p>
                  {!isUser && message.source ? (
                    <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      Fonte: {message.source === "openai" ? "API IA" : "Fallback local"}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}

        {sending ? (
          <article className="border-b border-[#2b2c33] bg-[#202123] px-4 py-5 md:px-6">
            <div className="mx-auto flex max-w-4xl gap-3">
              <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3a3b45] text-xs font-semibold text-slate-200">
                AI
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Assistente</p>
                <p className="mt-2 text-sm text-slate-300">Pensando...</p>
              </div>
            </div>
          </article>
        ) : null}
      </div>

      <div className="border-t border-[#3a3b45] bg-[#202123] px-4 py-3 md:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-full border border-[#4a4b57] bg-[#2a2b32] px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400/60 hover:text-cyan-100"
                onClick={() => void sendMessage(prompt)}
                disabled={sending}
              >
                {prompt}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit}>
            <div className="rounded-2xl border border-[#4a4b57] bg-[#2a2b32] p-2">
              <textarea
                className="max-h-52 min-h-[88px] w-full resize-y bg-transparent px-2 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-400"
                placeholder="Pergunte qualquer coisa sobre os dados do CRM..."
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                disabled={sending}
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <p className="text-[11px] text-slate-400">
                  Diga &quot;quero acompanhar esse insight&quot; para ativar monitoramento continuo.
                </p>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSend}
                >
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </form>

          {errorMessage ? <p className="mt-2 text-xs text-rose-300">{errorMessage}</p> : null}
        </div>
      </div>
    </section>
  );
}
