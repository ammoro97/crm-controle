import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { readLeadsCollection, writeLeadsCollection } from "@/lib/leads-customers-store";
import { reloadResponsaveisGlobal } from "@/lib/responsaveis-store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/leads/dividir
 *
 * Distribui leads outbound não acionados igualmente entre vendedores ativos.
 * "Não acionado" = firstContactDate vazio E sem registros em crm_calls.
 * Executa no servidor para garantir atomicidade — nenhum lead é distribuído
 * parcialmente.
 */
export async function POST() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    // 1. Carregar vendedores ativos
    const responsaveis = await reloadResponsaveisGlobal();
    const vendedores = responsaveis
      .filter((r) => r.tipo === "vendedor")
      .map((r) => r.nome)
      .filter(Boolean);

    if (vendedores.length === 0) {
      return NextResponse.json(
        { success: false, message: "Nenhum vendedor ativo cadastrado." },
        { status: 422 },
      );
    }

    // 2. Leads com chamadas registradas (considerados acionados)
    const admin = getSupabaseAdmin();
    const acionadosIds = new Set<string>();
    if (admin) {
      const { data } = await admin
        .from("crm_calls")
        .select("lead_id")
        .not("lead_id", "is", null);
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row.lead_id) acionadosIds.add(String(row.lead_id));
        }
      }
    }

    // 3. Carregar todos os leads e filtrar não acionados outbound
    const allLeads = await readLeadsCollection();
    const naoAcionados = allLeads.filter((lead) => {
      if (lead.channel !== "outbound") return false;
      const hasFirstContact = Boolean(String(lead.firstContactDate || "").trim());
      const hasCalls = acionadosIds.has(lead.id);
      return !hasFirstContact && !hasCalls;
    });

    if (naoAcionados.length === 0) {
      return NextResponse.json({
        success: true,
        distributed: 0,
        message: "Nenhum lead nao acionado encontrado.",
      });
    }

    // 4. Distribuir round-robin (resto vai para os primeiros)
    const updatedLeads = naoAcionados.map((lead, index) => ({
      ...lead,
      owner: vendedores[index % vendedores.length],
    }));

    // 5. Mesclar de volta na coleção completa e persistir (upsert puro)
    const updatedIds = new Set(updatedLeads.map((l) => l.id));
    const merged = [
      ...allLeads.filter((l) => !updatedIds.has(l.id)),
      ...updatedLeads,
    ];
    await writeLeadsCollection(merged);

    return NextResponse.json({
      success: true,
      distributed: updatedLeads.length,
      vendedores: vendedores.length,
      message: `${updatedLeads.length} leads distribuídos entre ${vendedores.length} vendedor(es).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno ao dividir leads.";
    console.error("[DIVIDIR] erro:", message);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
