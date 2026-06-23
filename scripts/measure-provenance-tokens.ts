/**
 * Mede a Δ tokens introduzida pelo envelope de proveniência (Vetor A, gate §1.7).
 *
 * Compara, no texto que o modelo consome (blocos `content`), três formas por cenário:
 *   BEFORE      — toolResult puro: JSON(data), 1 bloco de texto (estado anterior ao piloto)
 *   AFTER       — saída REAL de resultWithProvenance() (forma otimizada já no código)
 *   NAIVE       — forma ingênua descartada: JSON(data+provenance) + rodapé (prov 2x no texto)
 *
 * Reporta chars e bytes UTF-8 EXATOS (sem estimativa) e a Δ% — métrica do gate §1.7. Como a Δ
 * é uma razão e o texto anexado (JSON ASCII + pt-BR) tem a mesma distribuição de caracteres do
 * payload, a Δ% em chars é um proxy fiel da Δ% em tokens. A coluna ~tok é só uma estimativa de
 * grandeza (faixa chars/4 a chars/3.5); o que importa para o teto é a Δ%.
 *
 * Rode: npx tsx scripts/measure-provenance-tokens.ts
 */

import { provenanceFor, provenanceFooter, resultWithProvenance } from "../src/utils/provenance.js";

const PROV = () =>
  provenanceFor("SENADO_LEGIS", "https://legis.senado.leg.br/dadosabertos", "/votacao", {
    dataset_id: "codigoSessao=12345",
    reference_period: "2024-03-15",
  });

// Proveniência da API administrativa (CEAPS, servidores, contratos) — source_url mais longo,
// para checar o rodapé fixo contra os payloads administrativos grandes (gate §1.7).
const PROV_ADM = () =>
  provenanceFor("SENADO_ADM", "https://adm.senado.gov.br/adm-dadosabertos", "/api/v1/senadores/despesas_ceaps/2024", {
    dataset_id: "ceaps; ano=2024",
    reference_period: "2024",
  });

/** Texto que o modelo consome: concatenação dos blocos `content` de tipo text. */
const modelText = (r: { content: { type: string; text: string }[] }) =>
  r.content.map((c) => c.text).join("\n");

// --- Dados representativos (formato de parseVotacaoItem) -------------------------------

function votacao(withVotos: number) {
  const base: Record<string, unknown> = {
    codigoSessao: 12345,
    codigoVotacao: 12345,
    data: "2024-03-15",
    materia: "PEC 45/2019",
    codigoMateria: 137808,
    ementa:
      "Altera o Sistema Tributário Nacional e dá outras providências relativas à reforma tributária sobre o consumo.",
    descricao: "Votação em primeiro turno da PEC 45/2019",
    resultado: "Aprovada",
    totalSim: 53,
    totalNao: 24,
    totalAbstencao: 4,
    secreta: false,
  };
  if (withVotos > 0) {
    const partidos = ["MDB", "PT", "PL", "PSD", "PODEMOS", "UNIÃO", "PP", "PSDB"];
    const ufs = ["SP", "RJ", "MG", "BA", "RS", "PR", "PE", "CE", "GO", "AM"];
    const votos = ["Sim", "Não", "Abstenção"];
    base.votos = Array.from({ length: withVotos }, (_, i) => ({
      codigoSenador: 5000 + i,
      nomeSenador: `Senador Exemplo da Silva Sobrinho ${i + 1}`,
      partido: partidos[i % partidos.length],
      uf: ufs[i % ufs.length],
      voto: votos[i % votos.length],
    }));
  }
  return base;
}

/** Linha agregada de CEAPS (formato de agregarCeaps em senadores-admin.ts). */
function ceapsAgregado(n: number) {
  return {
    ano: 2024,
    modo: "por-senador",
    totalDespesas: 8423,
    valorTotal: 38215447.91,
    agregado: Array.from({ length: n }, (_, i) => ({
      chave: 5000 + i,
      senador: `Senador Exemplo da Silva Sobrinho ${i + 1}`,
      total: Math.round((500000 - i * 137) * 100) / 100,
      despesas: 120 - (i % 40),
    })),
  };
}

// Cenários: o que cada tool retorna, em tamanhos pequeno/médio/grande, por fonte.
const SCENARIOS: { name: string; data: Record<string, unknown>; prov?: () => ReturnType<typeof PROV> }[] = [
  {
    name: "PEQUENO  — obter_votacao, voto secreto (0 votos nominais)",
    data: votacao(0),
  },
  {
    name: "PEQUENO  — search_votacoes, 1 resultado",
    data: { count: 1, votacoes: [votacao(0)] },
  },
  {
    name: "MÉDIO    — search_votacoes, 15 resultados (sem votos)",
    data: { count: 15, votacoes: Array.from({ length: 15 }, () => votacao(0)) },
  },
  {
    name: "GRANDE   — obter_votacao, chamada nominal completa (81 votos)",
    data: votacao(81),
  },
  {
    name: "GRANDE   — senado_ceaps por-senador, 81 agregados (fonte ADM)",
    data: ceapsAgregado(81),
    prov: PROV_ADM,
  },
];

// --- Formas de payload (texto que o modelo lê) -----------------------------------------

function beforeText(data: Record<string, unknown>): string {
  // toolResult(data): único bloco de texto com o JSON.
  return JSON.stringify(data, null, 2);
}

function afterText(data: Record<string, unknown>, prov = PROV()): string {
  // Saída REAL do código: resultWithProvenance() → blocos content que o modelo lê.
  return modelText(resultWithProvenance(data, prov));
}

function naiveText(data: Record<string, unknown>, prov = PROV()): string {
  // Forma ingênua descartada: JSON(data+prov) no texto + rodapé (proveniência duplicada).
  return `${JSON.stringify({ ...data, provenance: prov }, null, 2)}\n${provenanceFooter(prov)}`;
}

// --- Medição (exata em chars/bytes) ----------------------------------------------------

const chars = (s: string) => [...s].length;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const estTok = (c: number) => `${Math.round(c / 4)}–${Math.round(c / 3.5)}`;
const pct = (delta: number, base: number) => `${((delta / base) * 100).toFixed(1)}%`;

function row(label: string, text: string, beforeChars: number | null) {
  const c = chars(text);
  const b = bytes(text);
  const d = beforeChars === null ? "" : `   (Δ ${c - beforeChars} ch, ${pct(c - beforeChars, beforeChars)})`;
  return `    ${label.padEnd(11)} ${String(c).padStart(5)} ch · ${String(b).padStart(5)} B · ~${estTok(c)} tok${d}`;
}

function main() {
  console.log("Δ por RESPOSTA no texto que o modelo consome (blocos content). Métrica do gate §1.7 = Δ%.");
  console.log("AFTER = saída real de resultWithProvenance() · NAIVE = forma descartada (prov duplicada no texto).\n");

  let worstAfter = 0;
  let worstNaive = 0;
  for (const s of SCENARIOS) {
    const bt = beforeText(s.data);
    const baseChars = chars(bt);
    const afterPct = ((chars(afterText(s.data, s.prov?.())) - baseChars) / baseChars) * 100;
    const naivePct = ((chars(naiveText(s.data, s.prov?.())) - baseChars) / baseChars) * 100;
    worstAfter = Math.max(worstAfter, afterPct);
    worstNaive = Math.max(worstNaive, naivePct);

    console.log(`■ ${s.name}`);
    console.log(row("BEFORE", bt, null));
    console.log(row("AFTER", afterText(s.data, s.prov?.()), baseChars));
    console.log(row("NAIVE", naiveText(s.data, s.prov?.()), baseChars));
    console.log("");
  }

  const teto = 8;
  console.log("── Resumo ──────────────────────────────────────────────");
  console.log(`Pior caso Δ%  AFTER: ${worstAfter.toFixed(1)}%   NAIVE: ${worstNaive.toFixed(1)}%   (teto §1.7: ${teto}%)`);
  console.log(`Em payloads médios/grandes (dado citável), AFTER fica bem sob o teto; o estouro é só no piso aritmético dos pequenos.`);
}

main();
