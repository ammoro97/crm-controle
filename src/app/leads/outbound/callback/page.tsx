import { OutboundCallbackView } from "@/components/leads/outbound-callback-view";

export default function OutboundCallbackPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-6 xl:px-6">
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Outbound</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-100">Callback</h1>
        <p className="mt-1 text-xs text-slate-500">
          Leads que solicitaram ou foram direcionados para retorno de ligação.
        </p>
      </div>
      <OutboundCallbackView />
    </div>
  );
}
