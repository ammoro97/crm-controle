export type LeadStatus =
  | "Novo"
  | "Contato iniciado"
  | "Qualificado"
  | "Reuniao marcada"
  | "Proposta enviada"
  | "Perdido"
  | "Fechado";
export type LeadChannel = "inbound" | "outbound";
export type LeadUrgency = "baixa" | "media" | "alta";
export type LeadTemperature = "frio" | "morno" | "quente";
export type InteractionType = "ligacao" | "whatsapp" | "reuniao" | "email";
export type BusinessType = "estetica" | "odontologia";
export type PainPoint =
  | "perde leads"
  | "demora no atendimento"
  | "agenda baguncada"
  | "sem acompanhamento"
  | "equipe desorganizada";
export type BuyingMoment = "pesquisando" | "curioso" | "avaliando" | "quer resolver" | "urgente";

export type InboundInterest =
  | "organizar agenda"
  | "automatizar atendimento"
  | "aumentar conversao"
  | "melhorar follow-up";

export type LeadHistoryEvent = {
  id: string;
  date: string;
  time: string;
  eventType: string;
  description: string;
  owner: string;
  linkedObservationId?: string;
  linkedTab?: "observacoes";
};

export type LeadObservationType = "contato" | "follow-up" | "objecao" | "informacao interna" | "negociacao";

export type LeadObservation = {
  id: string;
  date: string;
  time: string;
  owner: string;
  type: LeadObservationType;
  content: string;
};

export type InboundQualification = {
  campaign: string;
  mainInterest: InboundInterest;
  initialMessage: string;
  businessType: BusinessType;
  specialty: string;
  monthlyRevenueRange: string;
  averageLeadsPerMonth: string;
  painPoints: PainPoint[];
  mainProblem: string;
  decisionMakerIdentified: "sim" | "nao";
  buyingMoment: BuyingMoment;
  icpFit: "alto" | "medio" | "baixo";
};

export type OutboundQualification = {
  decisionContacts: Array<{
    name: string;
    phone: string;
    email: string;
  }>;
  whoAnswered: string;
  attemptCount: "1" | "2" | "3" | "4+";
  businessType: BusinessType;
  specialty: string;
  monthlyRevenueRange: string;
  averageLeadsPerMonth: string;
  employeeCountRange: "1-5" | "6-15" | "16-30" | "30+";
  unitCount: "1" | "2" | "3" | "4+";
  painPoints: PainPoint[];
  mainProblem: string;
  usesCrm: "sim" | "nao";
  crmName: string;
  usesDigitalSchedule: "sim" | "nao";
  usesSpreadsheet: "sim" | "nao";
  usesNothing: "sim" | "nao";
  decisionMakerIdentified: "sim" | "nao";
  buyingMoment: BuyingMoment;
  icpFit: "alto" | "medio" | "baixo";
  teamSize?: string;
};

export type Lead = {
  id: string;
  name: string;
  company: string;
  phone: string;
  status: LeadStatus;
  source: string;
  owner: string;
  email: string;
  notes: string;
  channel: LeadChannel;
  city: string;
  niche: string;
  entryDate: string;
  firstContactDate?: string;
  lastInteraction: string;
  nextAction: string;
  nextActionDate?: string;
  lossReason?: string;
  temperature: LeadTemperature;
  history: LeadHistoryEvent[];
  inboundQualification?: InboundQualification;
  outboundQualification?: OutboundQualification;
  internalNotes: string[];
  observationLog: LeadObservation[];
};

export type CallReason = "apresentacao" | "acompanhamento" | "fechamento" | "follow-up";

export type Meeting = {
  id: string;
  personName: string;
  date: string;
  callTime: string;
  reason: CallReason;
  owner: string;
  notes?: string;
};

export type CallStatus = "Atendida" | "Nao atendida" | "Ocupado" | "Cancelada";

export type CallRecord = {
  id: string;
  leadId?: string;
  nome: string;
  empresa: string;
  telefone: string;
  data: string;
  inicio: string;
  fim: string;
  duracao: string;
  status: CallStatus;
  observacao?: string;
  origem?: string;
  ultimoContatoTipo?: "ligacao";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  recordUrl?: string;
  transcript?: string;
  aiAnalysis?: string;
};

export type CallLog = {
  id: string;
  leadId?: string | null;
  nome?: string;
  empresa?: string;
  telefone?: string;
  caller?: string;
  called?: string;
  direction?: string;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  hangupCause?: string | null;
  hangupCauseCode?: string | null;
  recordUrl?: string | null;
  gateway?: string | null;
  eventType?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
  transcript?: string | null;
  aiAnalysis?: string | null;
  processingStatus?: "pending" | "processing" | "done" | "error";
};
