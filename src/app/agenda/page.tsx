"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { AgendaBlocksModal } from "@/components/agenda/agenda-blocks-modal";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { AgendaFilters } from "@/components/agenda/agenda-filters";
import { AgendaAllList } from "@/components/agenda/agenda-all-list";
import { AgendaList } from "@/components/agenda/agenda-list";
import { AgendaPeriodNavigator } from "@/components/agenda/agenda-period-navigator";
import { AppointmentModal } from "@/components/agenda/appointment-modal";
import { getMeetingReasonStyle } from "@/components/agenda/reason-style";
import { AgendaBlocks, AgendaDisplayMode, AgendaPeriodMode, emptyAgendaBlocks } from "@/components/agenda/agenda-types";
import {
  clampDateToPresent,
  filterFutureMeetings,
  formatPeriodLabel,
  getCurrentReferenceDate,
  BlockingInfo,
  getBlockingInfo,
  getPeriodBounds,
  isPastDateTime,
  moveDateByPeriod,
  startOfDay,
  toIsoDate,
} from "@/components/agenda/agenda-utils";
import { PageTopbar } from "@/components/layout/page-topbar";
import { Modal } from "@/components/ui/modal";
import { getMeetingsSnapshot, setMeetingsSnapshot } from "@/lib/crm-data-store";
import { useResponsaveis } from "@/lib/responsaveis-store";
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import { Meeting } from "@/types/crm";

function createEmptyMeeting(date = "", owner = ""): Meeting {
  return {
    id: `M-${Date.now()}`,
    personName: "",
    date,
    callTime: "09:00",
    reason: "apresentacao",
    owner,
    notes: "",
  };
}

const AGENDA_BLOCKS_STORAGE_KEY = "crm.agenda.blocks.v1";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatIsoDateBr(iso: string) {
  const [yyyy = "", mm = "", dd = ""] = (iso || "").split("-");
  if (!yyyy || !mm || !dd) return iso;
  return `${dd}/${mm}/${yyyy}`;
}

function getMeetingSearchableText(meeting: Meeting) {
  const formattedDate = formatIsoDateBr(meeting.date);
  return normalizeSearchText(
    [
      meeting.personName,
      meeting.owner,
      meeting.reason,
      meeting.notes || "",
      meeting.date,
      formattedDate,
      meeting.callTime,
    ].join(" "),
  );
}

export default function AgendaPage() {
  const { currentUser } = useAuth();
  const [displayMode, setDisplayMode] = useState<AgendaDisplayMode>("calendario");
  const [periodMode, setPeriodMode] = useState<AgendaPeriodMode>("mes");
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(getCurrentReferenceDate()));
  const [meetings, setMeetings] = useState<Meeting[]>(() => getMeetingsSnapshot());
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("Todos");
  const [open, setOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [pendingDeleteMeeting, setPendingDeleteMeeting] = useState<Meeting | null>(null);
  const [blockingAlert, setBlockingAlert] = useState<{
    message: string;
    category: string;
    reason: string;
    extraDetail?: string;
  } | null>(null);
  const [resolvedOwnerName, setResolvedOwnerName] = useState("");
  const [resolvedOwnerError, setResolvedOwnerError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<AgendaBlocks>(() => {
    if (typeof window === "undefined") return emptyAgendaBlocks;
    try {
      const raw = window.localStorage.getItem(AGENDA_BLOCKS_STORAGE_KEY);
      if (!raw) return emptyAgendaBlocks;
      const parsed = JSON.parse(raw) as AgendaBlocks;
      return {
        recurringWeekdayBlocks: parsed.recurringWeekdayBlocks || [],
        specificDateBlocks: parsed.specificDateBlocks || [],
        periodBlocks: parsed.periodBlocks || [],
        specificTimeBlocks: parsed.specificTimeBlocks || [],
      };
    } catch {
      return emptyAgendaBlocks;
    }
  });

  const periodLabel = formatPeriodLabel(selectedDate, periodMode);
  const ownerOptions = useResponsaveis(true);
  const effectiveOwnerFilter = ownerOptions.includes(ownerFilter) ? ownerFilter : "Todos";
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedQuery = normalizeSearchText(deferredSearchTerm);
  const hasActiveSearch = normalizeSearchText(searchTerm).length > 0;
  const [nowRef, setNowRef] = useState<Date>(() => getCurrentReferenceDate());
  const today = startOfDay(nowRef);

  useEffect(() => {
    let mounted = true;
    const loadOwner = async () => {
      const resolved = await resolveResponsavelFromUserAsync(currentUser);
      if (!mounted) return;
      if (!resolved.linked || !resolved.responsavel) {
        setResolvedOwnerName("");
        setResolvedOwnerError(
          "Seu usuario autenticado ainda nao esta vinculado a um responsavel no CRM. Cadastre o e-mail em Configuracoes > Responsaveis.",
        );
        return;
      }
      setResolvedOwnerName(resolved.responsavel.nome);
      setResolvedOwnerError(null);
    };
    void loadOwner();
    return () => {
      mounted = false;
    };
  }, [currentUser]);

  const monthOptions = useMemo(() => {
    const selectedYear = selectedDate.getFullYear();
    const startMonth = selectedYear === today.getFullYear() ? today.getMonth() : 0;
    return Array.from({ length: 12 - startMonth }).map((_, index) => {
      const monthIndex = startMonth + index;
      const date = new Date(selectedYear, monthIndex, 1);
      const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      return {
        monthIndex,
        year: selectedYear,
        label: label.charAt(0).toUpperCase() + label.slice(1),
      };
    });
  }, [selectedDate, today]);

  const futureMeetings = useMemo(() => filterFutureMeetings(meetings, nowRef), [meetings, nowRef]);

  const ownerFilteredMeetings = useMemo(() => {
    if (effectiveOwnerFilter === "Todos") return futureMeetings;
    return futureMeetings.filter((meeting) => meeting.owner === effectiveOwnerFilter);
  }, [futureMeetings, effectiveOwnerFilter]);

  const visibleMeetings = useMemo(() => {
    if (!hasActiveSearch) return ownerFilteredMeetings;
    return ownerFilteredMeetings.filter((meeting) => getMeetingSearchableText(meeting).includes(normalizedQuery));
  }, [ownerFilteredMeetings, hasActiveSearch, normalizedQuery]);

  const searchResults = useMemo(
    () =>
      [...visibleMeetings].sort((a, b) => `${a.date} ${a.callTime}`.localeCompare(`${b.date} ${b.callTime}`)),
    [visibleMeetings],
  );

  const movePeriod = (direction: -1 | 1) => {
    setSelectedDate((current) => {
      if (direction === -1) {
        const candidate = moveDateByPeriod(current, periodMode, -1);
        const bounds = getPeriodBounds(candidate, periodMode);
        if (bounds.end < today) return current;
        return clampDateToPresent(candidate, nowRef);
      }
      return moveDateByPeriod(current, periodMode, 1);
    });
  };

  const canGoPrevious = useMemo(() => {
    const candidate = moveDateByPeriod(selectedDate, periodMode, -1);
    const bounds = getPeriodBounds(candidate, periodMode);
    return bounds.end >= today;
  }, [periodMode, selectedDate, today]);

  const showBlockingAlert = (info: BlockingInfo) => {
    if (info.type === "specific_time") {
      setBlockingAlert({
        message: "Nao e possivel agendar neste horario, pois ele esta bloqueado.",
        category: "Horario Especifico",
        reason: info.reason,
        extraDetail: `Bloqueado das ${info.startTime} as ${info.endTime}`,
      });
      return;
    }

    if (info.type === "specific_date") {
      setBlockingAlert({
        message: "Nao e possivel agendar nesta data, pois ela esta bloqueada.",
        category: "Dia Especifico (unico)",
        reason: info.reason,
        extraDetail: info.date
          ? `Data bloqueada: ${formatIsoDateBr(info.date)}`
          : undefined,
      });
      return;
    }

    if (info.type === "period") {
      setBlockingAlert({
        message: "Nao e possivel agendar nesta data, pois ela esta dentro de um periodo bloqueado.",
        category: "Periodo (intervalo de datas)",
        reason: info.reason,
        extraDetail:
          info.startDate && info.endDate
            ? `Periodo bloqueado: ${formatIsoDateBr(info.startDate)} ate ${formatIsoDateBr(info.endDate)}`
            : undefined,
      });
      return;
    }

    setBlockingAlert({
      message: "Nao e possivel agendar neste dia da semana, pois ele esta bloqueado.",
      category: "Dia da Semana (recorrente)",
      reason: info.reason,
    });
  };

  const openNew = () => {
    if (!resolvedOwnerName) {
      setBlockingAlert({
        message: "Nao foi possivel criar agendamento sem responsavel vinculado.",
        category: "Responsavel nao vinculado",
        reason: resolvedOwnerError || "Vincule seu e-mail em Configuracoes > Responsaveis.",
      });
      return;
    }
    setSelected(createEmptyMeeting(toIsoDate(selectedDate), resolvedOwnerName));
    setIsNew(true);
    setOpen(true);
  };

  const openFromDate = (date: string, time?: string) => {
    if (isPastDateTime(date, time || "09:00", nowRef)) {
      setBlockingAlert({
        message: "Nao e possivel agendar em data ou horario que ja passou.",
        category: "Horario vencido",
        reason: "Selecione um horario futuro.",
      });
      return;
    }
    const blockInfo = getBlockingInfo(date, time || "09:00", blocks);
    if (blockInfo) {
      showBlockingAlert(blockInfo);
      return;
    }
    if (!resolvedOwnerName) {
      setBlockingAlert({
        message: "Nao foi possivel criar agendamento sem responsavel vinculado.",
        category: "Responsavel nao vinculado",
        reason: resolvedOwnerError || "Vincule seu e-mail em Configuracoes > Responsaveis.",
      });
      return;
    }
    setSelected({ ...createEmptyMeeting(date, resolvedOwnerName), callTime: time || "09:00" });
    setIsNew(true);
    setOpen(true);
  };

  const openExisting = (meeting: Meeting) => {
    setSelected(meeting);
    setIsNew(false);
    setOpen(true);
  };

  const saveMeeting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    if (!resolvedOwnerName) {
      setBlockingAlert({
        message: "Nao foi possivel salvar agendamento sem responsavel vinculado.",
        category: "Responsavel nao vinculado",
        reason: resolvedOwnerError || "Vincule seu e-mail em Configuracoes > Responsaveis.",
      });
      return;
    }
    if (isPastDateTime(selected.date, selected.callTime, nowRef)) {
      setBlockingAlert({
        message: "Nao e possivel agendar em data ou horario que ja passou.",
        category: "Horario vencido",
        reason: "Selecione um horario futuro.",
      });
      return;
    }
    const blockInfo = getBlockingInfo(selected.date, selected.callTime, blocks);
    if (blockInfo) {
      showBlockingAlert(blockInfo);
      return;
    }

    const normalizedSelected = {
      ...selected,
      owner: resolvedOwnerName,
    };

    setMeetings((prev) => {
      if (isNew) return [...prev, normalizedSelected];
      return prev.map((meeting) => (meeting.id === selected.id ? normalizedSelected : meeting));
    });

    setOpen(false);
    setSelected(null);
    setIsNew(false);
  };

  const deleteMeeting = (meetingId: string) => {
    setMeetings((prev) => prev.filter((meeting) => meeting.id !== meetingId));
    setPendingDeleteMeeting(null);
  };

  const updateBlocks = (next: AgendaBlocks) => {
    setBlocks(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AGENDA_BLOCKS_STORAGE_KEY, JSON.stringify(next));
    }
  };

  useEffect(() => {
    const saveId = setTimeout(() => {
      setMeetingsSnapshot(meetings);
    }, 220);
    return () => clearTimeout(saveId);
  }, [meetings]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowRef(getCurrentReferenceDate());
    }, 60000);
    return () => clearInterval(intervalId);
  }, []);


  return (
    <section>
      <PageTopbar
        title="Agenda"
        addLabel="Novo Agendamento"
        onAdd={openNew}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Buscar por nome, responsavel, data, horario ou motivo"
        className="border-slate-800/90 bg-slate-950/70"
        searchClassName="border-slate-700 bg-slate-900/70 text-slate-100 placeholder:text-slate-400 focus:border-emerald-400"
        addButtonClassName="bg-emerald-400 text-slate-900 hover:bg-emerald-300"
      />

      <div className="rounded-2xl border border-slate-200/90 bg-slate-100 p-4 md:p-5">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <AgendaFilters
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              periodMode={periodMode}
              onPeriodModeChange={setPeriodMode}
            />
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[220px]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Responsavel
                </span>
                <select
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-emerald-400"
                  value={effectiveOwnerFilter}
                  onChange={(event) => setOwnerFilter(event.target.value)}
                >
                  {ownerOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={() => setBlocksOpen(true)}
              >
                Configurar Bloqueios
              </button>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Navegacao</p>
                <AgendaPeriodNavigator
                  label={periodLabel}
                  disablePrevious={!canGoPrevious}
                  monthOptions={monthOptions}
                  onSelectMonth={(monthIndex, year) => {
                    const candidate = new Date(year, monthIndex, 1);
                    setSelectedDate(clampDateToPresent(candidate, nowRef));
                  }}
                  onPrevious={() => movePeriod(-1)}
                  onNext={() => movePeriod(1)}
                />
              </div>
            </div>
          </div>
        </div>

        {hasActiveSearch ? (
          <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Resultados da busca</p>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {searchResults.length}
              </span>
            </div>
            {searchResults.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">Nenhum agendamento encontrado.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto p-3">
                {searchResults.map((meeting) => {
                  const reasonStyle = getMeetingReasonStyle(meeting.reason);
                  return (
                  <button
                    key={`search-${meeting.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedDate(new Date(`${meeting.date}T00:00:00`));
                      openExisting(meeting);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{meeting.personName}</p>
                        <p className={`inline-flex rounded-md px-2 py-0.5 text-xs uppercase tracking-wide ${reasonStyle.badgeClass}`}>
                          {reasonStyle.label}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="rounded-md bg-slate-100 px-2 py-1">
                          {formatIsoDateBr(meeting.date)}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-1">{meeting.callTime}</span>
                        <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-700">{meeting.owner}</span>
                      </div>
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-500">{meeting.notes || "-"}</p>
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {displayMode === "calendario" ? (
          <AgendaCalendar
            meetings={visibleMeetings}
            blocks={blocks}
            selectedDate={selectedDate}
            periodMode={periodMode}
            onSelectDate={setSelectedDate}
            onCreateOnDate={openFromDate}
            onSelectMeeting={openExisting}
          />
        ) : displayMode === "lista" ? (
          <AgendaList
            meetings={visibleMeetings}
            selectedDate={selectedDate}
            periodMode={periodMode}
            onSelectMeeting={openExisting}
          />
        ) : (
          <AgendaAllList
            meetings={visibleMeetings}
            onEditMeeting={openExisting}
            onDeleteMeeting={(meeting) => setPendingDeleteMeeting(meeting)}
          />
        )}
      </div>

      <AppointmentModal
        open={open}
        isNew={isNew}
        meeting={selected}
        onClose={() => {
          setOpen(false);
          setSelected(null);
          setIsNew(false);
        }}
        onChange={setSelected}
        onSubmit={saveMeeting}
      />

      <AgendaBlocksModal open={blocksOpen} blocks={blocks} onClose={() => setBlocksOpen(false)} onChange={updateBlocks} />

      <Modal
        title="Confirmar exclusao"
        open={Boolean(pendingDeleteMeeting)}
        onClose={() => setPendingDeleteMeeting(null)}
      >
        {pendingDeleteMeeting ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-200">Tem certeza que deseja excluir este agendamento?</p>
            <div className="rounded-lg border border-border bg-slate-900/50 p-3 text-sm text-slate-100">
              <p className="font-semibold">{pendingDeleteMeeting.personName}</p>
              <p className="mt-1 text-slate-300">
                {formatIsoDateBr(pendingDeleteMeeting.date)} -{" "}
                {pendingDeleteMeeting.callTime}
              </p>
              <p className="text-slate-300">Responsavel: {pendingDeleteMeeting.owner}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" onClick={() => setPendingDeleteMeeting(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                onClick={() => deleteMeeting(pendingDeleteMeeting.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {blockingAlert ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="panel w-full max-w-md">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">Agendamento nao permitido</h2>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
              <p>{blockingAlert.message}</p>
              <p>
                <span className="font-semibold text-slate-100">Categoria:</span> {blockingAlert.category}
              </p>
              {blockingAlert.extraDetail ? <p>{blockingAlert.extraDetail}</p> : null}
              <p>
                <span className="font-semibold text-slate-100">Motivo:</span> {blockingAlert.reason}
              </p>
            </div>
            <div className="border-t border-border px-5 py-3">
              <button type="button" className="btn-primary" onClick={() => setBlockingAlert(null)}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
