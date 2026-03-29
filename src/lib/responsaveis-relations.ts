"use client";

import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  setMeetingsSnapshot,
} from "@/lib/crm-data-store";

export type ResponsavelImpact = {
  leadCount: number;
  meetingCount: number;
  total: number;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function getResponsavelImpact(name: string): ResponsavelImpact {
  const normalized = normalize(name);
  const leads = getLeadsSnapshot();
  const meetings = getMeetingsSnapshot();
  const leadCount = leads.filter((lead) => normalize(lead.owner) === normalized).length;
  const meetingCount = meetings.filter((meeting) => normalize(meeting.owner) === normalized).length;
  return {
    leadCount,
    meetingCount,
    total: leadCount + meetingCount,
  };
}

export function transferResponsavelVinculos(fromName: string, toName: string) {
  const fromNormalized = normalize(fromName);
  const toNormalized = normalize(toName);
  if (!fromNormalized || !toNormalized || fromNormalized === toNormalized) return;

  const leads = getLeadsSnapshot().map((lead) =>
    normalize(lead.owner) === fromNormalized
      ? {
          ...lead,
          owner: toName,
        }
      : lead,
  );
  const meetings = getMeetingsSnapshot().map((meeting) =>
    normalize(meeting.owner) === fromNormalized
      ? {
          ...meeting,
          owner: toName,
        }
      : meeting,
  );

  setLeadsSnapshot(leads);
  setMeetingsSnapshot(meetings);
}
