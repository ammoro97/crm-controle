import { Lead, LeadContactQuality, LeadEmail, LeadPhone } from "@/types/crm";

function clean(values: string[]): string[] {
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeQuality(value: unknown): LeadContactQuality | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bom" || normalized === "ruim") return normalized;
  return undefined;
}

function uniqueBy<T>(items: T[], keyBuilder: (item: T) => string): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function phoneUniqKey(value: string) {
  const digits = normalizeDigits(value);
  return digits || value.toLowerCase();
}

function emailUniqKey(value: string) {
  return value.toLowerCase();
}

function splitMultiValueText(value: string): string[] {
  return String(value || "")
    .split(/[\n\r|;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseLeadPhoneColumnValue(value?: string[] | string | null): string[] {
  const rawValues = Array.isArray(value) ? value : [String(value || "")];
  const exploded = rawValues.flatMap((item) => splitMultiValueText(String(item || "")));
  const normalized = clean(exploded);
  return uniqueBy(normalized, (item) => phoneUniqKey(item));
}

function normalizePhoneItems(items: LeadPhone[], fallbackQualityMap?: Map<string, LeadContactQuality | undefined>): LeadPhone[] {
  const normalized = items
    .map((item) => {
      const value = String(item?.value || "").trim();
      if (!value) return null;
      const key = phoneUniqKey(value);
      const quality = normalizeQuality(item?.quality) || fallbackQualityMap?.get(key);
      return {
        value,
        ...(quality ? { quality } : {}),
      } satisfies LeadPhone;
    })
    .filter((item): item is LeadPhone => item !== null);

  return uniqueBy(normalized, (item) => phoneUniqKey(item.value));
}

function normalizeEmailItems(items: LeadEmail[], fallbackQualityMap?: Map<string, LeadContactQuality | undefined>): LeadEmail[] {
  const normalized = items
    .map((item) => {
      const value = String(item?.value || "").trim();
      if (!value) return null;
      const key = emailUniqKey(value);
      const quality = normalizeQuality(item?.quality) || fallbackQualityMap?.get(key);
      return {
        value,
        ...(quality ? { quality } : {}),
      } satisfies LeadEmail;
    })
    .filter((item): item is LeadEmail => item !== null);

  return uniqueBy(normalized, (item) => emailUniqKey(item.value));
}

function buildPhoneQualityMap(lead: Lead) {
  return new Map(
    getLeadPhoneItems(lead).map((item) => [phoneUniqKey(item.value), normalizeQuality(item.quality)] satisfies [
      string,
      LeadContactQuality | undefined,
    ]),
  );
}

function buildEmailQualityMap(lead: Lead) {
  return new Map(
    getLeadEmailItems(lead).map((item) => [emailUniqKey(item.value), normalizeQuality(item.quality)] satisfies [
      string,
      LeadContactQuality | undefined,
    ]),
  );
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

export function getLeadPhoneItems(lead: Lead): LeadPhone[] {
  const columnPhones = [
    ...parseLeadPhoneColumnValue(lead.telefone_google),
    ...parseLeadPhoneColumnValue(lead.telefone_cnpj),
  ];
  const columnPhoneItems = columnPhones.map((value) => ({ value }));

  if (Array.isArray(lead.phoneItems) && lead.phoneItems.length > 0) {
    return normalizePhoneItems([...lead.phoneItems, ...columnPhoneItems]);
  }

  const fromArray = Array.isArray(lead.phones) ? clean(lead.phones) : [];
  if (fromArray.length > 0 || columnPhones.length > 0) {
    return normalizePhoneItems([
      ...fromArray.map((value) => ({ value })),
      ...columnPhoneItems,
    ]);
  }

  const primaryItems = clean([lead.phone || ""]).map((value) => ({ value }));
  return normalizePhoneItems([...primaryItems, ...columnPhoneItems]);
}

export function getLeadEmailItems(lead: Lead): LeadEmail[] {
  if (Array.isArray(lead.emailItems) && lead.emailItems.length > 0) {
    return normalizeEmailItems(lead.emailItems);
  }

  const fromArray = Array.isArray(lead.emails) ? clean(lead.emails) : [];
  if (fromArray.length > 0) {
    return fromArray.map((value) => ({ value }));
  }

  return clean([lead.email || ""]).map((value) => ({ value }));
}

export function getLeadPhones(lead: Lead): string[] {
  return getLeadPhoneItems(lead).map((item) => item.value);
}

export function getLeadEmails(lead: Lead): string[] {
  return getLeadEmailItems(lead).map((item) => item.value);
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

export function updateLeadPhoneItems(lead: Lead, phoneItems: LeadPhone[]): Lead {
  const normalized = normalizePhoneItems(phoneItems, buildPhoneQualityMap(lead));
  const phones = normalized.map((item) => item.value);
  return {
    ...lead,
    phoneItems: normalized,
    phones,
    phone: phones[0] || "",
  };
}

export function updateLeadEmailItems(lead: Lead, emailItems: LeadEmail[]): Lead {
  const normalized = normalizeEmailItems(emailItems, buildEmailQualityMap(lead));
  const emails = normalized.map((item) => item.value);
  return {
    ...lead,
    emailItems: normalized,
    emails,
    email: emails[0] || "",
  };
}

export function updateLeadPhones(lead: Lead, phones: string[]): Lead {
  const qualityMap = buildPhoneQualityMap(lead);
  const normalized = clean(phones).map((value) => ({
    value,
    quality: qualityMap.get(phoneUniqKey(value)),
  }));
  return updateLeadPhoneItems(lead, normalized);
}

export function updateLeadEmails(lead: Lead, emails: string[]): Lead {
  const qualityMap = buildEmailQualityMap(lead);
  const normalized = clean(emails).map((value) => ({
    value,
    quality: qualityMap.get(emailUniqKey(value)),
  }));
  return updateLeadEmailItems(lead, normalized);
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
