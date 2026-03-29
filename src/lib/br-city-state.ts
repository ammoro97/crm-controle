const CITY_TO_STATE: Record<string, string> = {
  "bauru": "SP",
  "belo horizonte": "MG",
  "curitiba": "PR",
  "sao paulo": "SP",
  "rio de janeiro": "RJ",
  "campinas": "SP",
  "ribeirao preto": "SP",
  "santos": "SP",
  "sao jose dos campos": "SP",
  "sao jose do rio preto": "SP",
  "goiania": "GO",
  "brasilia": "DF",
  "salvador": "BA",
  "fortaleza": "CE",
  "manaus": "AM",
  "belem": "PA",
  "porto alegre": "RS",
  "florianopolis": "SC",
  "vitoria": "ES",
  "cuiaba": "MT",
  "campo grande": "MS",
  "recife": "PE",
  "joao pessoa": "PB",
  "natal": "RN",
  "maceio": "AL",
  "aracaju": "SE",
  "teresina": "PI",
  "sao luis": "MA",
  "palmas": "TO",
  "rio branco": "AC",
  "porto velho": "RO",
  "boa vista": "RR",
  "macapa": "AP",
};

function normalizeCity(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getStateFromCity(city: string): string | null {
  const key = normalizeCity(city);
  if (!key) return null;
  return CITY_TO_STATE[key] || null;
}
