import Link from "next/link";

type CardItem = {
  title: string;
  description: string;
  href: string;
};

const ITEMS: CardItem[] = [
  {
    title: "Responsaveis",
    description: "Gerencie vendedores e gestores que atuam no CRM.",
    href: "/configuracoes/responsaveis",
  },
  {
    title: "Integracoes",
    description: "Acesse os modulos de Webhook e API4 por area separada.",
    href: "/configuracoes/integracoes",
  },
];

export function ConfiguracoesCards() {
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
