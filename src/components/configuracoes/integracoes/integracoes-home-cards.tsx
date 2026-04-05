import Link from "next/link";

const ITEMS = [
  {
    title: "Webhook",
    description: "Configure entrada e saida de eventos de integracao.",
    href: "/configuracoes/integracoes/webhook",
  },
  {
    title: "API4",
    description: "Gerencie os ramais cadastrados e adicione novas conexoes.",
    href: "/configuracoes/integracoes/api4",
  },
] as const;

export function IntegracoesHomeCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {ITEMS.map((item) => (
        <Link
          key={item.title}
          href={item.href}
          className="group rounded-2xl border border-border bg-slate-900/60 p-5 transition hover:border-cyan-400/40 hover:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-100">{item.title}</h2>
            <span className="rounded-md border border-border bg-slate-950/60 px-2 py-1 text-xs font-semibold text-slate-300 transition group-hover:border-cyan-400/40 group-hover:text-cyan-200">
              Abrir
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-400">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}
