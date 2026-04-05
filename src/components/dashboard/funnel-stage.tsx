"use client";

import type { ReactNode } from "react";

// Variants map 1:1 to funnel stage semantics.
// Values mirror the `funnel.*` tokens in tailwind.config.ts — keep in sync.
type FunnelStageVariant = "blue" | "violet" | "green" | "orange" | "emerald";

type FunnelStageProps = {
  label: string;
  value: string | number;
  widthPercent: number;
  variant: FunnelStageVariant;
  icon?: ReactNode;
  animateIn: boolean;
  index: number;
};

const VARIANT_STYLES: Record<FunnelStageVariant, { from: string; to: string; glow: string }> = {
  // Ligações — topo, informativo
  blue: {
    from: "#3B82F6",
    to: "#2563EB",
    glow: "rgba(59,130,246,0.30)",
  },
  // Atendidas — qualificação inicial
  violet: {
    from: "#8B5CF6",
    to: "#7C3AED",
    glow: "rgba(139,92,246,0.30)",
  },
  // Decisor — contato qualificado
  green: {
    from: "#22C55E",
    to: "#16A34A",
    glow: "rgba(34,197,94,0.28)",
  },
  // Fechamento — oportunidade aquecida
  orange: {
    from: "#F97316",
    to: "#EA580C",
    glow: "rgba(249,115,22,0.28)",
  },
  // Compras — conversão / sucesso (verde mais forte)
  emerald: {
    from: "#16A34A",
    to: "#15803D",
    glow: "rgba(22,163,74,0.32)",
  },
};

function clampWidthPercent(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(40, Math.min(100, value));
}

export function FunnelStage({ label, value, widthPercent, variant, icon, animateIn, index }: FunnelStageProps) {
  const style = VARIANT_STYLES[variant];
  const safeWidth = clampWidthPercent(widthPercent);
  const valueText = String(value);
  const compactValue = valueText.length >= 6;

  return (
    <div className="relative mx-auto w-full max-w-[680px]">
      <div
        className="group relative mx-auto h-[76px] overflow-hidden border border-white/10 sm:h-[82px] md:h-[88px]"
        style={{
          width: animateIn ? `${safeWidth}%` : "0%",
          clipPath: "polygon(6% 0%, 94% 0%, 86% 100%, 14% 100%)",
          backgroundImage: `linear-gradient(108deg, ${style.from}, ${style.to})`,
          boxShadow: `0 14px 34px rgba(2,6,23,0.42), 0 0 0 1px rgba(255,255,255,0.05), 0 0 24px ${style.glow}`,
          transitionProperty: "width, box-shadow, transform",
          transitionDuration: "760ms",
          transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
          transitionDelay: `${index * 90}ms`,
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.2)_0%,rgba(255,255,255,0.07)_42%,rgba(255,255,255,0)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-[1px] bg-white/30" />
        <div className="absolute inset-x-0 bottom-0 h-[1px] bg-black/20" />

        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          <p className="w-full truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85 md:text-[11px]">
            {label}
          </p>
          <div className="mt-1.5 inline-flex max-w-full items-center justify-center gap-1.5 text-white">
            {icon ? <span className="shrink-0 opacity-85">{icon}</span> : null}
            <span
              className={`whitespace-nowrap font-semibold tracking-[-0.03em] ${
                compactValue ? "text-[26px] sm:text-[30px] md:text-[34px]" : "text-[30px] sm:text-[34px] md:text-[38px]"
              }`}
            >
              {value}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
