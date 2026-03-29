import { Lead } from "@/types/crm";

function clean(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function getLeadNames(lead: Lead): string[] {
  const fromArray = Array.isArray(lead.names) ? clean(lead.names) : [];
  if (fromArray.length > 0) return fromArray;
  return clean([lead.name || ""]);
}

export function getLeadPhones(lead: Lead): string[] {
  const fromArray = Array.isArray(lead.phones) ? clean(lead.phones) : [];
  if (fromArray.length > 0) return fromArray;
  return clean([lead.phone || ""]);
}

export function getLeadEmails(lead: Lead): string[] {
  const fromArray = Array.isArray(lead.emails) ? clean(lead.emails) : [];
  if (fromArray.length > 0) return fromArray;
  return clean([lead.email || ""]);
}

export function updateLeadNames(lead: Lead, names: string[]): Lead {
  const normalized = clean(names);
  return {
    ...lead,
    names: normalized,
    name: normalized[0] || "",
  };
}

export function updateLeadPhones(lead: Lead, phones: string[]): Lead {
  const normalized = clean(phones);
  return {
    ...lead,
    phones: normalized,
    phone: normalized[0] || "",
  };
}

export function updateLeadEmails(lead: Lead, emails: string[]): Lead {
  const normalized = clean(emails);
  return {
    ...lead,
    emails: normalized,
    email: normalized[0] || "",
  };
}
