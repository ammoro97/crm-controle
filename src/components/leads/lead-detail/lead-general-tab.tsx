import { useEffect, useMemo, useRef, useState } from "react";
import { getStateFromCity } from "@/lib/br-city-state";
import { getLeadContacts, getLeadEmails, getLeadPhones, updateLeadContacts, updateLeadEmails, updateLeadPhones } from "@/lib/lead-contact-utils";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { Lead } from "@/types/crm";
import { ChannelBadge } from "./lead-detail-shared";
import { LeadInlineField } from "./lead-inline-field";
import { LeadSectionCard } from "./lead-section-card";

type LeadGeneralTabProps = {
  lead: Lead;
  draftLead: Lead;
  isEditing: boolean;
  onActivateEdit: () => void;
  onEditingStateChange?: (editing: boolean) => void;
  onDraftChange: (next: Lead) => void;
};

type EditableKey =
  | "contacts"
  | "phones"
  | "emails"
  | "company"
  | "owner"
  | "city"
  | "state"
  | "entryDate";

function parseCityState(value: string): { city: string; state: string } {
  const raw = String(value || "").trim();
  if (!raw) return { city: "", state: "" };

  if (raw.includes(">")) {
    const [city, state] = raw.split(">").map((item) => item.trim());
    return { city: city || "", state: state || "" };
  }
  if (raw.includes("-")) {
    const [city, state] = raw.split("-").map((item) => item.trim());
    return { city: city || "", state: state || "" };
  }
  return { city: raw, state: "" };
}

function formatDateBR(iso: string): string {
  const [year, month, day] = String(iso || "").split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

function parseDateBR(dateBR: string): string {
  const cleaned = String(dateBR || "").trim();
  const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

type ContactsFieldProps = {
  value: Array<{ nome: string; cargo: string }>;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (next: Array<{ nome: string; cargo: string }>) => void;
};

function ContactsField({ value, isEditing, onOpen, onClose, onChange }: ContactsFieldProps) {
  const [localContacts, setLocalContacts] = useState<Array<{ nome: string; cargo: string }>>(() =>
    value.length > 0 ? [...value] : [{ nome: "", cargo: "" }],
  );
  const prevIsEditingRef = useRef(isEditing);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (isEditing !== prevIsEditingRef.current) {
      prevIsEditingRef.current = isEditing;
      const current = valueRef.current;
      setLocalContacts(current.length > 0 ? [...current] : [{ nome: "", cargo: "" }]);
    }
  });

  const contacts = isEditing ? localContacts : (value.length > 0 ? value : [{ nome: "", cargo: "" }]);

  const updateAt = (index: number, key: "nome" | "cargo", nextValue: string) => {
    const next = localContacts.map((item, idx) => (idx === index ? { ...item, [key]: nextValue } : item));
    setLocalContacts(next);
    onChange(next);
  };

  const add = () => {
    setLocalContacts((prev) => [...prev, { nome: "", cargo: "" }]);
  };

  const remove = (index: number) => {
    const next = localContacts.filter((_, idx) => idx !== index);
    const withFallback = next.length > 0 ? next : [{ nome: "", cargo: "" }];
    setLocalContacts(withFallback);
    onChange(withFallback);
  };

  return (
    <div
      className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${!isEditing ? "cursor-pointer transition hover:border-slate-600/80 hover:bg-slate-900/70" : ""}`}
      onClick={() => {
        if (!isEditing) onOpen();
      }}
      role={!isEditing ? "button" : undefined}
      tabIndex={!isEditing ? 0 : -1}
      onKeyDown={(event) => {
        if (!isEditing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.09em] text-muted">Nome + Cargo</p>
      {isEditing ? (
        <>
          <div className="mt-2 space-y-2">
            {contacts.map((contact, index) => (
              <div key={`contact-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className="field h-9 px-2.5 py-1.5 text-sm"
                  placeholder="Nome"
                  value={contact.nome}
                  onChange={(event) => updateAt(index, "nome", event.target.value)}
                />
                <input
                  className="field h-9 px-2.5 py-1.5 text-sm"
                  placeholder="Cargo"
                  value={contact.cargo}
                  onChange={(event) => updateAt(index, "cargo", event.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md border border-border px-2.5 text-xs text-slate-200 transition hover:bg-slate-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800" onClick={add}>
              + adicionar nome
            </button>
            <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      ) : (
        <div className="mt-1.5 space-y-1">
          {value.length === 0 ? <p className="text-sm text-slate-100">-</p> : null}
          {value.map((item, index) => (
            <p key={`${item.nome}-${item.cargo}-${index}`} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100">
              {item.nome || "-"} | {item.cargo || "-"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

type MultiInputFieldProps = {
  label: string;
  values: string[];
  addButtonLabel: string;
  placeholder: string;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (next: string[]) => void;
};

function MultiInputField({ label, values, addButtonLabel, placeholder, isEditing, onOpen, onClose, onChange }: MultiInputFieldProps) {
  const [localList, setLocalList] = useState<string[]>(() => values.length > 0 ? [...values] : [""]);
  const prevIsEditingRef = useRef(isEditing);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (isEditing !== prevIsEditingRef.current) {
      prevIsEditingRef.current = isEditing;
      const current = valuesRef.current;
      setLocalList(current.length > 0 ? [...current] : [""]);
    }
  });

  const list = isEditing ? localList : (values.length > 0 ? values : [""]);

  const updateAt = (index: number, value: string) => {
    const next = localList.map((item, idx) => (idx === index ? value : item));
    setLocalList(next);
    onChange(next);
  };

  // Adiciona linha vazia ao estado local — nao propaga para o pai pois string
  // vazia seria filtrada por clean(). O item persiste quando o usuario digitar.
  const add = () => {
    setLocalList((prev) => [...prev, ""]);
  };

  const remove = (index: number) => {
    const next = localList.filter((_, idx) => idx !== index);
    const withFallback = next.length > 0 ? next : [""];
    setLocalList(withFallback);
    onChange(withFallback);
  };

  return (
    <div
      className={`rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 ${!isEditing ? "cursor-pointer transition hover:border-slate-600/80 hover:bg-slate-900/70" : ""}`}
      onClick={() => {
        if (!isEditing) onOpen();
      }}
      role={!isEditing ? "button" : undefined}
      tabIndex={!isEditing ? 0 : -1}
      onKeyDown={(event) => {
        if (!isEditing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.09em] text-muted">{label}</p>
      {isEditing ? (
        <>
          <div className="mt-2 space-y-2">
            {list.map((item, index) => (
              <div key={`${label}-${index}`} className="flex items-center gap-2">
                <input
                  className="field h-9 flex-1 px-2.5 py-1.5 text-sm"
                  placeholder={placeholder}
                  value={item}
                  onChange={(event) => updateAt(index, event.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md border border-border px-2.5 text-xs text-slate-200 transition hover:bg-slate-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800" onClick={add}>
              {addButtonLabel}
            </button>
            <button type="button" className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      ) : (
        <div className="mt-1.5 space-y-1">
          {values.length === 0 ? <p className="text-sm text-slate-100">-</p> : null}
          {values.map((item, index) => (
            <p key={`${item}-${index}`} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-100">
              {item}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadGeneralTab({
  lead,
  draftLead,
  isEditing,
  onActivateEdit,
  onEditingStateChange,
  onDraftChange,
}: LeadGeneralTabProps) {
  const ownerOptions = useResponsaveis();
  const contacts = useMemo(() => getLeadContacts(draftLead), [draftLead]);
  const phones = useMemo(() => getLeadPhones(draftLead), [draftLead]);
  const emails = useMemo(() => getLeadEmails(draftLead), [draftLead]);
  const cityState = useMemo(() => parseCityState(draftLead.city), [draftLead.city]);
  const autoDetectedState = useMemo(() => getStateFromCity(cityState.city), [cityState.city]);
  const effectiveState = autoDetectedState || cityState.state;
  const [activeField, setActiveField] = useState<EditableKey | null>(null);
  const [entryDateDraft, setEntryDateDraft] = useState(formatDateBR(draftLead.entryDate || ""));

  const toggleField = (key: EditableKey) => {
    const next = activeField === key ? null : key;
    setActiveField(next);
    onEditingStateChange?.(next !== null);
    if (next !== null) onActivateEdit();
  };

  useEffect(() => {
    if (!isEditing) {
      setActiveField(null);
    }
  }, [isEditing]);

  useEffect(() => {
    setEntryDateDraft(formatDateBR(draftLead.entryDate || ""));
  }, [draftLead.entryDate]);

  const updateCityState = (city: string, state: string) => {
    const stateClean = state.trim();
    onDraftChange({
      ...draftLead,
      city: stateClean ? `${city} - ${stateClean}` : city,
    });
  };

  const onCityChange = (value: string) => {
    if (!value.trim()) {
      updateCityState("", "");
      return;
    }
    // Detecta estado pelo nome da cidade mas preserva o valor original com espacos
    const detected = getStateFromCity(value.trim());
    if (detected) {
      updateCityState(value, detected);
      return;
    }
    updateCityState(value, "");
  };

  return (
    <div className="space-y-4">
      <LeadSectionCard title="Identificacao">
        <div className="grid gap-2 md:grid-cols-2">
          <ContactsField
            value={contacts}
            isEditing={activeField === "contacts"}
            onOpen={() => toggleField("contacts")}
            onClose={() => toggleField("contacts")}
            onChange={(next) => onDraftChange(updateLeadContacts(draftLead, next))}
          />

          <LeadInlineField
            label="Empresa"
            value={draftLead.company}
            editable
            isEditing={activeField === "company"}
            onActivateEdit={() => toggleField("company")}
            onChange={(value) => onDraftChange({ ...draftLead, company: value })}
          />

          <MultiInputField
            label="Telefone"
            values={phones}
            addButtonLabel="+ adicionar telefone"
            placeholder="Telefone"
            isEditing={activeField === "phones"}
            onOpen={() => toggleField("phones")}
            onClose={() => toggleField("phones")}
            onChange={(next) => onDraftChange(updateLeadPhones(draftLead, next))}
          />

          <LeadInlineField
            label="Vendedor"
            value={draftLead.owner}
            editable
            isEditing={activeField === "owner"}
            type="select"
            selectOptions={ownerOptions}
            onActivateEdit={() => toggleField("owner")}
            onChange={(value) => onDraftChange({ ...draftLead, owner: value })}
          />

          <MultiInputField
            label="Email"
            values={emails}
            addButtonLabel="+ adicionar email"
            placeholder="Email"
            isEditing={activeField === "emails"}
            onOpen={() => toggleField("emails")}
            onClose={() => toggleField("emails")}
            onChange={(next) => onDraftChange(updateLeadEmails(draftLead, next))}
          />

          <LeadInlineField
            label="Cidade"
            value={cityState.city}
            editable
            isEditing={activeField === "city"}
            onActivateEdit={() => toggleField("city")}
            onChange={onCityChange}
          />

          <LeadInlineField
            label="Estado"
            value={effectiveState}
            editable={!autoDetectedState}
            isEditing={activeField === "state"}
            onActivateEdit={() => {
              if (!autoDetectedState) {
                toggleField("state");
              }
            }}
            onChange={(value) => updateCityState(cityState.city, value)}
          />

          <LeadInlineField
            label="Data de entrada"
            value={activeField === "entryDate" ? entryDateDraft : formatDateBR(draftLead.entryDate || "")}
            editable
            isEditing={activeField === "entryDate"}
            onActivateEdit={() => toggleField("entryDate")}
            onChange={(value) => {
              setEntryDateDraft(value);
              const iso = parseDateBR(value);
              if (iso) {
                onDraftChange({ ...draftLead, entryDate: iso });
              }
            }}
          />

          <div className="rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.09em] text-muted">Canal</p>
            <div className="mt-1.5">
              <ChannelBadge channel={lead.channel} />
            </div>
          </div>

          {lead.channel === "outbound" && lead.horario_funcionamento ? (
            <div className="rounded-lg border border-border/80 bg-slate-950/40 px-3 py-2.5 md:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.09em] text-muted">Horario de Funcionamento</p>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-100">{lead.horario_funcionamento}</p>
            </div>
          ) : null}
        </div>
      </LeadSectionCard>
    </div>
  );
}
