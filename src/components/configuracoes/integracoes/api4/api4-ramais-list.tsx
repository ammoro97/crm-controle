import { Api4RamalCard, type Api4RamalView } from "./api4-ramal-card";

type Api4RamaisListProps = {
  items: Api4RamalView[];
  loading: boolean;
  testingId: string | null;
  onEdit: (item: Api4RamalView) => void;
  onTest: (item: Api4RamalView) => void;
};

export function Api4RamaisList({ items, loading, testingId, onEdit, onTest }: Api4RamaisListProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-slate-900/40 p-4 text-sm text-slate-400">
        Carregando ramais cadastrados...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-slate-900/30 p-6 text-sm text-slate-400">
        Nenhum ramal cadastrado. Use o botao <span className="font-semibold text-slate-200">Adicionar novo ramal</span>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Api4RamalCard key={item.id} item={item} testingId={testingId} onEdit={onEdit} onTest={onTest} />
      ))}
    </div>
  );
}
