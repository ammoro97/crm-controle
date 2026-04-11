// Publica um evento Realtime Broadcast para todos os clientes conectados.
// Usa a REST API do Supabase Realtime — sem WebSocket no servidor.
// Fire-and-forget: falha silenciosa não bloqueia o response ao cliente.

const BROADCAST_CHANNEL = "crm-updates";
const BROADCAST_TIMEOUT_MS = 3_000;

export type CrmBroadcastEvent = "leads_changed" | "calls_changed" | "customers_changed";

export async function broadcastCrmUpdate(
  event: CrmBroadcastEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceKey) return;

  const endpoint = `${supabaseUrl}/realtime/v1/api/broadcast`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: BROADCAST_CHANNEL,
            event,
            payload,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch {
    // Não-crítico: o polling periódico garante consistência eventual.
  } finally {
    clearTimeout(timer);
  }
}
