import type { Lead } from "@/types/crm";

export const LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE = "NO_ELIGIBLE_RESPONSAVEIS" as const;

export class LeadOwnerDistributionError extends Error {
  code: typeof LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE;

  constructor(message: string) {
    super(message);
    this.name = "LeadOwnerDistributionError";
    this.code = LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE;
  }
}

type DistributionParams = {
  incomingLeads: Lead[];
  existingLeads?: Lead[];
  eligibleOwners: string[];
};

type DistributionResult = {
  leads: Lead[];
  assignedCount: number;
};

function normalizeOwnerName(value?: string | null) {
  return String(value || "").trim();
}

function normalizeOwnerKey(value?: string | null) {
  return normalizeOwnerName(value).toLocaleLowerCase("pt-BR");
}

function sortOwners(owners: string[]) {
  return [...owners].sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }));
}

function normalizeEligibleOwners(owners: string[]) {
  const byKey = new Map<string, string>();
  for (const owner of owners) {
    const normalized = normalizeOwnerName(owner);
    if (!normalized) continue;
    const key = normalizeOwnerKey(normalized);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, normalized);
  }
  return sortOwners(Array.from(byKey.values()));
}

function resolveOwnerByKey(owners: string[]) {
  const byKey = new Map<string, string>();
  for (const owner of owners) {
    byKey.set(normalizeOwnerKey(owner), owner);
  }
  return byKey;
}

function pickNextOwner(ownerCounts: Map<string, number>, sortedOwners: string[]) {
  let chosen = sortedOwners[0];
  let chosenCount = ownerCounts.get(chosen) ?? 0;

  for (let index = 1; index < sortedOwners.length; index += 1) {
    const candidate = sortedOwners[index];
    const candidateCount = ownerCounts.get(candidate) ?? 0;
    if (candidateCount < chosenCount) {
      chosen = candidate;
      chosenCount = candidateCount;
      continue;
    }
    if (candidateCount === chosenCount) {
      const isBefore = candidate.localeCompare(chosen, "pt-BR", { sensitivity: "base" }) < 0;
      if (isBefore) {
        chosen = candidate;
        chosenCount = candidateCount;
      }
    }
  }

  return chosen;
}

export function distributeLeadOwners(params: DistributionParams): DistributionResult {
  const incomingLeads = Array.isArray(params.incomingLeads) ? params.incomingLeads : [];
  const existingLeads = Array.isArray(params.existingLeads) ? params.existingLeads : [];
  const eligibleOwners = normalizeEligibleOwners(params.eligibleOwners || []);
  const ownerByKey = resolveOwnerByKey(eligibleOwners);
  const eligibleOwnerKeys = new Set(Array.from(ownerByKey.keys()));

  const existingById = new Map<string, Lead>();
  for (const lead of existingLeads) {
    const leadId = String(lead?.id || "").trim();
    if (!leadId) continue;
    existingById.set(leadId, lead);
  }

  const normalizedLeads: Lead[] = incomingLeads.map((lead) => ({ ...lead }));
  const pendingIndices: number[] = [];
  const ownerCounts = new Map<string, number>();

  for (const owner of eligibleOwners) {
    ownerCounts.set(owner, 0);
  }

  for (let index = 0; index < normalizedLeads.length; index += 1) {
    const lead = normalizedLeads[index];
    const leadId = String(lead?.id || "").trim();

    const directOwnerName = normalizeOwnerName(lead.owner);
    const directOwnerKey = normalizeOwnerKey(directOwnerName);
    const hasDirectEligibleOwner = directOwnerKey && eligibleOwnerKeys.has(directOwnerKey);
    if (hasDirectEligibleOwner) {
      const canonicalOwner = ownerByKey.get(directOwnerKey) as string;
      normalizedLeads[index] = { ...lead, owner: canonicalOwner };
      ownerCounts.set(canonicalOwner, (ownerCounts.get(canonicalOwner) ?? 0) + 1);
      continue;
    }

    const existingOwnerName = normalizeOwnerName(existingById.get(leadId)?.owner);
    const existingOwnerKey = normalizeOwnerKey(existingOwnerName);
    const hasExistingEligibleOwner = existingOwnerKey && eligibleOwnerKeys.has(existingOwnerKey);
    if (hasExistingEligibleOwner) {
      const canonicalOwner = ownerByKey.get(existingOwnerKey) as string;
      normalizedLeads[index] = { ...lead, owner: canonicalOwner };
      ownerCounts.set(canonicalOwner, (ownerCounts.get(canonicalOwner) ?? 0) + 1);
      continue;
    }

    pendingIndices.push(index);
  }

  if (pendingIndices.length === 0) {
    return {
      leads: normalizedLeads,
      assignedCount: 0,
    };
  }

  if (eligibleOwners.length === 0) {
    throw new LeadOwnerDistributionError(
      "Nao existe responsavel elegivel cadastrado para distribuicao automatica de leads.",
    );
  }

  let assignedCount = 0;
  for (const index of pendingIndices) {
    const selectedOwner = pickNextOwner(ownerCounts, eligibleOwners);
    const lead = normalizedLeads[index];
    normalizedLeads[index] = {
      ...lead,
      owner: selectedOwner,
    };
    ownerCounts.set(selectedOwner, (ownerCounts.get(selectedOwner) ?? 0) + 1);
    assignedCount += 1;
  }

  return {
    leads: normalizedLeads,
    assignedCount,
  };
}

