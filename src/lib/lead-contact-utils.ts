import { Lead } from "@/types/crm";

function clean(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function getLeadNames(lead: Lead): string[] {
  const fromContacts = Array.isArray(lead.contacts)
    ? lead.contacts.map((item) => String(item?.nome || "").trim()).filter(Boolean)
    : [];
  if (fromContacts.length > 0) return fromContacts;

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
  const existingContacts = Array.isArray(lead.contacts) ? lead.contacts : [];
  const contacts = normalized.map((nome, index) => ({
    nome,
    cargo: String(existingContacts[index]?.cargo || "").trim(),
  }));
  return {
    ...lead,
    names: normalized,
    name: normalized[0] || "",
    contacts,
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

export function getLeadContacts(lead: Lead): Array<{ nome: string; cargo: string }> {
  if (Array.isArray(lead.contacts) && lead.contacts.length > 0) {
    return lead.contacts.map((item) => ({
      nome: String(item?.nome || "").trim(),
      cargo: String(item?.cargo || "").trim(),
    }));
  }

  return getLeadNames(lead).map((nome) => ({ nome, cargo: "" }));
}

export function updateLeadContacts(lead: Lead, contacts: Array<{ nome: string; cargo: string }>): Lead {
  const normalized = contacts
    .map((item) => ({
      nome: String(item.nome || "").trim(),
      cargo: String(item.cargo || "").trim(),
    }))
    .filter((item) => item.nome || item.cargo);

  const names = normalized.map((item) => item.nome).filter(Boolean);

  return {
    ...lead,
    contacts: normalized,
    names,
    name: names[0] || "",
  };
}
