"use client";

import { useMemo } from "react";
import { Meeting } from "@/types/crm";

type AgendaAllListProps = {
  meetings: Meeting[];
  onEditMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (meeting: Meeting) => void;
};

export function AgendaAllList({ meetings, onEditMeeting, onDeleteMeeting }: AgendaAllListProps) {
  const rows = useMemo(
    () => [...meetings].sort((a, b) => `${a.date} ${a.callTime}`.localeCompare(`${b.date} ${b.callTime}`)),
    [meetings],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nenhum agendamento encontrado.</p>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map((meeting) => (
            <article key={meeting.id} className="px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">{meeting.personName}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{meeting.reason}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded-md bg-slate-100 px-2 py-1">
                      {new Date(`${meeting.date}T00:00:00`).toLocaleDateString("pt-BR")}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-1">{meeting.callTime}</span>
                    <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-700">{meeting.owner}</span>
                  </div>
                  {meeting.notes ? <p className="text-xs text-slate-500">{meeting.notes}</p> : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    onClick={() => onEditMeeting(meeting)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                    onClick={() => onDeleteMeeting(meeting)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
