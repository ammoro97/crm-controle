"use client";

type FunnelStep = {
  id: "ligacoes" | "atendidas" | "decisor" | "agendamentos";
  label: "Ligações" | "Atendidas" | "Decisor" | "Agendamentos";
  value: number;
  gradientFrom: string;
  gradientTo: string;
};

type DashboardFunnelProps = {
  ligacoes: number;
  atendidas: number;
  decisor: number;
  agendamentos: number;
};

export function DashboardFunnel({ ligacoes, atendidas, decisor, agendamentos }: DashboardFunnelProps) {
  const steps: FunnelStep[] = [
    {
      id: "ligacoes",
      label: "Ligações",
      value: ligacoes,
      gradientFrom: "#3B82F6",
      gradientTo: "#1D4ED8",
    },
    {
      id: "atendidas",
      label: "Atendidas",
      value: atendidas,
      gradientFrom: "#8B5CF6",
      gradientTo: "#6D28D9",
    },
    {
      id: "decisor",
      label: "Decisor",
      value: decisor,
      gradientFrom: "#F59E0B",
      gradientTo: "#D97706",
    },
    {
      id: "agendamentos",
      label: "Agendamentos",
      value: agendamentos,
      gradientFrom: "#22C55E",
      gradientTo: "#16A34A",
    },
  ];

  const maxValue = Math.max(1, ...steps.map((step) => step.value));

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0F172A]/95 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02),0_18px_42px_rgba(2,6,23,0.34)] md:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_-4%,rgba(56,189,248,0.2),transparent_40%),radial-gradient(circle_at_84%_120%,rgba(168,85,247,0.16),transparent_45%)]" />
      <div className="relative">
        <h2 className="text-sm font-semibold uppercase tracking-[0.09em] text-slate-300">Funil de Agendamento</h2>
        <p className="mt-1 text-xs text-slate-400">Ligações → Atendidas → Decisor → Agendamentos</p>

        <div className="mt-4 space-y-2.5">
          {steps.map((step, index) => {
            const width = Math.max(48, Math.round((step.value / maxValue) * 100));
            return (
              <div key={step.id} className="flex justify-center">
                <div
                  className="relative h-14 w-full max-w-[520px] overflow-hidden border border-slate-700/80 shadow-[0_10px_24px_rgba(15,23,42,0.45)]"
                  style={{
                    width: `${width}%`,
                    clipPath: "polygon(8% 0, 92% 0, 100% 100%, 0 100%)",
                    backgroundImage: `linear-gradient(90deg, ${step.gradientFrom}, ${step.gradientTo})`,
                    marginTop: index === 0 ? 0 : "-2px",
                  }}
                >
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0)_35%)]" />
                  <div className="relative flex h-full items-center justify-between px-4">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/95">{step.label}</span>
                    <span className="text-xl font-semibold tracking-[-0.02em] text-white">{step.value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

