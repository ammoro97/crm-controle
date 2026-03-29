"use client";

import { FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { useResponsaveis } from "@/lib/responsaveis-store";
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
  const responsaveis = useResponsaveis();

  return (
    <Modal title={isNew ? "Novo Agendamento" : "Detalhes do Agendamento"} open={open} onClose={onClose}>
      {meeting ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            Nome da pessoa
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
              onChange={(e) => onChange({ ...meeting, reason: e.target.value as CallReason })}
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
            <select
              className="field mt-1"
              value={meeting.owner}
              onChange={(e) => onChange({ ...meeting, owner: e.target.value })}
              required
            >
              <option value="">Selecione...</option>
              {responsaveis.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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
