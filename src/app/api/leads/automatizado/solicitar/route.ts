import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";
import { CALL_ANALYSIS_SECRET_HEADER } from "@/types/call-analysis";
const CRM_EVENT_OUTBOUND = "outbound" as const;

export type SolicitacaoApiPayload = {
  tipoAutomacao: "api";
  totalLeads: number;
  nicho: string;
  pais: "Brasil";
  estado?: string;
  cidade?: string;
};

export type SolicitacaoCnpjPayload = {
  tipoAutomacao: "cnpj";
  cnae: string;
  cidade?: string;
  estado?: string;
  anos?: number;
  quantidade: number;
};

export type SolicitacaoPayload = SolicitacaoApiPayload | SolicitacaoCnpjPayload;

export type SolicitacaoResponse = {
  success: boolean;
  leads?: never[];
  count?: number;
  pending?: boolean;
  message?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as SolicitacaoPayload;

    if (!body.tipoAutomacao || !["api", "cnpj"].includes(body.tipoAutomacao)) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: "Tipo de automacao invalido." },
        { status: 400 },
      );
    }

    if (body.tipoAutomacao === "api") {
      if (!body.totalLeads || body.totalLeads <= 0) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Total de leads obrigatorio e deve ser maior que zero." },
          { status: 400 },
        );
      }
      if (!body.nicho?.trim()) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Nicho obrigatorio para automacao por API." },
          { status: 400 },
        );
      }
    }

    if (body.tipoAutomacao === "cnpj") {
      if (!body.cnae?.trim()) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "CNAE obrigatorio para automacao por CNPJ." },
          { status: 400 },
        );
      }
      if (!body.quantidade || body.quantidade <= 0) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Quantidade obrigatoria e deve ser maior que zero." },
          { status: 400 },
        );
      }
    }

    const config = await getWebhookOutConfig();
    if (!isWebhookOutConfigured(config)) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: "Webhook de saida nao configurado. Configure em Configuracoes > Integracoes." },
        { status: 400 },
      );
    }

    const payload = { event: CRM_EVENT_OUTBOUND, ...body };

    const n8nResponse = await fetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        "x-crm-event": CRM_EVENT_OUTBOUND,
        ...(config.secret ? { [CALL_ANALYSIS_SECRET_HEADER]: config.secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!n8nResponse.ok) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: `Erro ao chamar automacao externa (HTTP ${n8nResponse.status}). Tente novamente.` },
        { status: 502 },
      );
    }

    // Descartar resposta sincrona do n8n — ela pode conter dados da execucao
    // anterior (cache/pin do n8n), causando duplicatas. Todos os leads devem
    // chegar pelo caminho assincrono: n8n → /retorno → Supabase → /pendentes.
    try {
      await n8nResponse.text(); // consome o body para evitar connection leak
    } catch {
      // ignora
    }

    return NextResponse.json<SolicitacaoResponse>({
      success: true,
      leads: [],
      count: 0,
      pending: true,
    });
  } catch (error) {
    console.error(
      "[LEADS_AUTOMATIZADO][SOLICITAR] Erro:",
      error instanceof Error ? error.message : "Erro desconhecido",
    );
    return NextResponse.json<SolicitacaoResponse>(
      { success: false, message: "Nao foi possivel processar a solicitacao." },
      { status: 500 },
    );
  }
}
