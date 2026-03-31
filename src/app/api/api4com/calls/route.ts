import { NextResponse } from "next/server";
import { getApi4ComConfig } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

const API4COM_CALLS_ENDPOINTS = [
  "https://api.api4com.com/api/v1/calls",
  "https://api.api4com.com/api/v1/call-history",
  "https://api.api4com.com/api/v1/call_logs",
  "https://api.api4com.com/api/v1/cdr",
];
let preferredCallsEndpoint = API4COM_CALLS_ENDPOINTS[0];

function toNumberSafe(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildQuery(page: number, filter: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (filter) params.set("filter", filter);
  return params.toString();
}

function extractItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const source = raw as Record<string, unknown>;
  if (Array.isArray(source.items)) return source.items;
  if (Array.isArray(source.data)) return source.data;
  if (source.data && typeof source.data === "object") {
    const data = source.data as Record<string, unknown>;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.calls)) return data.calls;
  }
  if (Array.isArray(source.records)) return source.records;
  if (Array.isArray(source.calls)) return source.calls;
  return [];
}

async function parseApiResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const page = toNumberSafe(searchParams.get("page"), 1);
    const filter = (searchParams.get("filter") || "").trim();

    const config = await getApi4ComConfig();
    const token = config.token.trim();

    if (!token) {
      return NextResponse.json({
        ok: false,
        error: "Token da API4COM nao configurado.",
      });
    }

    const query = buildQuery(page, filter);
    const endpoints = [
      preferredCallsEndpoint,
      ...API4COM_CALLS_ENDPOINTS.filter((endpoint) => endpoint !== preferredCallsEndpoint),
    ].map((endpoint) => `${endpoint}?${query}`);

    let lastError = "Nao foi possivel buscar historico na API4COM.";

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
          },
          cache: "no-store",
        });

        const raw = await parseApiResponse(response);

        if (!response.ok) {
          const message =
            raw && typeof raw === "object" && "message" in raw && typeof (raw as { message?: unknown }).message === "string"
              ? (raw as { message: string }).message
              : `Falha ao consultar historico`;
          lastError = message;
          continue;
        }

        preferredCallsEndpoint = endpoint.split("?")[0];

        return NextResponse.json({
          ok: true,
          items: extractItems(raw),
          raw,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Erro desconhecido ao consultar API4COM.";
      }
    }

    return NextResponse.json({ ok: false, error: lastError });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Erro interno ao buscar ligacoes.",
    });
  }
}
