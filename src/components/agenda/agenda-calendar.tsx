"use client";

import { Meeting } from "@/types/crm";
import { AgendaDayView } from "./agenda-day-view";
import { AgendaFortnightView } from "./agenda-fortnight-view";
import { AgendaMonthView } from "./agenda-month-view";
import { AgendaBlocks, AgendaPeriodMode } from "./agenda-types";
import { AgendaWeekView } from "./agenda-week-view";

type AgendaCalendarProps = {
  meetings: Meeting[];
  blocks: AgendaBlocks;
  selectedDate: Date;
  periodMode: AgendaPeriodMode;
  onSelectDate: (date: Date) => void;
  onCreateOnDate: (date: string, time?: string) => void;
  onSelectMeeting: (meeting: Meeting) => void;
};

export function AgendaCalendar({
  meetings,
  blocks,
  selectedDate,
  periodMode,
  onSelectDate,
  onCreateOnDate,
  onSelectMeeting,
}: AgendaCalendarProps) {
  if (periodMode === "dia") {
    return (
      <AgendaDayView
        selectedDate={selectedDate}
        meetings={meetings}
        blocks={blocks}
        onSelectMeeting={onSelectMeeting}
        onCreateOnDate={onCreateOnDate}
      />
    );
  }

  if (periodMode === "semana") {
    return (
      <AgendaWeekView
        selectedDate={selectedDate}
        meetings={meetings}
        blocks={blocks}
        onSelectDate={onSelectDate}
        onCreateOnDate={onCreateOnDate}
        onSelectMeeting={onSelectMeeting}
      />
    );
  }

  if (periodMode === "quinzena") {
    return (
      <AgendaFortnightView
        selectedDate={selectedDate}
        meetings={meetings}
        blocks={blocks}
        onSelectDate={onSelectDate}
        onCreateOnDate={onCreateOnDate}
        onSelectMeeting={onSelectMeeting}
      />
    );
  }

  return (
    <AgendaMonthView
      selectedDate={selectedDate}
      meetings={meetings}
      blocks={blocks}
      onSelectDate={onSelectDate}
      onCreateOnDate={onCreateOnDate}
      onSelectMeeting={onSelectMeeting}
    />
  );
}
