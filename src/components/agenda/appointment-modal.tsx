"use client";

import { FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { inferAgendaChannelFromType, inferAgendaEventTypeFromReason } from "@/lib/agenda-events";
import { CallReason, Meeting } from "@/types/crm";

type AppointmentModalProps = {
  open: boolean;
  isNew: boolean;
  meeting: Meeting | null;
  onClose: () => void;
  onChange: (meeting: Meeting) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

const reasonOptions: CallReason[] = ["apresentacao", "acompanhamento", "fechamento", "follow-up"];

export function AppointmentModal({
  open,
  isNew,
  meeting,
  onClose,
  onChange,
  onSubmit,
}: AppointmentModalProps) {
  return (
    <Modal title={isNew ? "Novo Agendamento" : "Detalhes do Agendamento"} open={open} onClose={onClose}>
      {meeting ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            Nome do cliente
            <input
              className="field mt-1"
              value={meeting.personName}
              onChange={(e) => onChange({ ...meeting, personName: e.target.value })}
              required
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Data
              <input
                className="field mt-1"
                type="date"
                value={meeting.date}
                onChange={(e) => onChange({ ...meeting, date: e.target.value })}
                required
              />
            </label>
            <label className="text-sm">
              Horario da call
              <input
                className="field mt-1"
                type="time"
                value={meeting.callTime}
                onChange={(e) => onChange({ ...meeting, callTime: e.target.value })}
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            Motivo da call
            <select
              className="field mt-1"
              value={meeting.reason}
              onChange={(e) => {
                const reason = e.target.value as CallReason;
                const eventType = inferAgendaEventTypeFromReason(reason);
                onChange({
                  ...meeting,
                  reason,
                  eventType,
                  channel: inferAgendaChannelFromType(eventType),
                });
              }}
            >
              {reasonOptions.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Responsavel
            <input className="field mt-1" value={meeting.owner} readOnly />
          </label>
          <label className="block text-sm">
            Observacoes
            <textarea
              className="field mt-1 min-h-24"
              value={meeting.notes || ""}
              onChange={(e) => onChange({ ...meeting, notes: e.target.value })}
            />
          </label>
          <button type="submit" className="btn-primary">
            Salvar
          </button>
        </form>
      ) : null}
    </Modal>
  );
}
