/**
 * Fase C4 do ROADMAP — invariantes das ideias, testados sobre o CONJUNTO das observações (camada 2).
 * Puro: recebe as observações, devolve as violações. Regras (medidas na amostra de 17/10/2026):
 *
 *   - `prazo120`: a data limite para apoios é a data da proposta + 120 dias exatos (medido em 4
 *     conversões de 2017–2020 e em 86/86 encerramentos). Conferido em cada leitura do detalhe.
 *   - `umaSugestao`: uma ideia gera no máximo UMA Sugestão (nº/ano) ao longo do tempo. Na mesma
 *     página o leitor já recusa duas; aqui a regra vale entre leituras.
 *   - `apoiosNaoDecrescem`: a contagem de apoios de uma ideia, lida pela mesma fonte, nunca diminui.
 *
 * Violação não é corrigida nem escondida: vira alerta, com as páginas (sha256) que a mostram, para
 * alguém olhar a fonte. Uma violação explicada entra em `invariantes-conhecidas.json` com o motivo
 * (`conhecidas`): continua listada no relatório, mas deixa de derrubar o job.
 */

import type { Observacao } from "./fundir.js";

export type Regra = "prazo120" | "umaSugestao" | "apoiosNaoDecrescem";

export interface Violacao {
  regra: Regra;
  entidade: string;
  entityId: string;
  fonte: string;
  /** O que se viu, em texto curto. */
  detalhe: string;
  /** Páginas do arquivo que mostram a violação (para abrir e conferir). */
  paginas: string[];
  /**
   * `violacao` derruba o job; `transitoria` (queda de uma leitura desfeita na seguinte: página
   * defasada do portal) e `pendente` (queda de uma leitura ainda sem a seguinte) só são relatadas.
   */
  tipo: "violacao" | "transitoria" | "pendente";
}

/** Chave estável de uma violação (para a lista das conhecidas). */
export const chaveDaViolacao = (v: Pick<Violacao, "regra" | "entidade" | "entityId" | "fonte">) =>
  `${v.regra}:${v.entidade}:${v.entityId}:${v.fonte}`;

const DIA_MS = 86_400_000;

export function mais120Dias(isoData: string): string {
  return new Date(Date.parse(`${isoData}T00:00:00Z`) + 120 * DIA_MS).toISOString().slice(0, 10);
}

function porSerie(obs: readonly Observacao[]): Map<string, Observacao[]> {
  const m = new Map<string, Observacao[]>();
  for (const o of obs) {
    const k = `${o.entidade}\u0000${o.entityId}\u0000${o.fonte}`;
    const l = m.get(k);
    if (l) l.push(o);
    else m.set(k, [o]);
  }
  return m;
}

/** A linha do `campo` ativa na leitura `indice` da série (cada leitura do detalhe traz todos os campos). */
function ativaEm(linhas: readonly Observacao[], campo: string, indice: number): Observacao | undefined {
  return linhas.find((o) => o.campo === campo && o.indicePrimeiro <= indice && indice <= o.indiceUltimo);
}

export function verificarInvariantes(obs: readonly Observacao[]): Violacao[] {
  const out: Violacao[] = [];
  for (const linhas of porSerie(obs).values()) {
    const { entidade, entityId, fonte } = linhas[0];
    if (entidade !== "ideias") continue;
    const base = { entidade, entityId, fonte };

    if (fonte === "detalhe") {
      // prazo = proposta + 120, em cada trecho de leituras com o mesmo prazo.
      for (const p of linhas) {
        if (p.campo !== "prazoApoios" || p.valor === null) continue;
        const prop = ativaEm(linhas, "dataProposta", p.indicePrimeiro);
        if (!prop?.valor) continue;
        const esperado = mais120Dias(prop.valor);
        if (p.valor !== esperado) {
          out.push({ ...base, regra: "prazo120", tipo: "violacao", detalhe: `proposta ${prop.valor} + 120 = ${esperado}, página diz ${p.valor}`, paginas: [p.shaPrimeiro] });
        }
      }
      // no máximo uma Sugestão ao longo do tempo
      const sugestoes = new Map<string, Observacao>();
      for (const o of linhas) {
        if (o.campo !== "sugestao" || o.valor === null) continue;
        const s = JSON.parse(o.valor) as { numero: number; ano: number };
        const k = `${s.numero}/${s.ano}`;
        if (!sugestoes.has(k)) sugestoes.set(k, o);
      }
      if (sugestoes.size > 1) {
        out.push({ ...base, regra: "umaSugestao", tipo: "violacao", detalhe: `Sugestões ${[...sugestoes.keys()].join(", ")}`, paginas: [...sugestoes.values()].map((o) => o.shaPrimeiro) });
      }
    }

    // apoios não diminuem, na ordem das leituras da mesma fonte
    const apoios = linhas.filter((o) => o.campo === "apoios" && o.valor !== null).sort((a, b) => a.indicePrimeiro - b.indicePrimeiro);
    for (let i = 1; i < apoios.length; i++) {
      const antes = Number(apoios[i - 1].valor);
      const depois = Number(apoios[i].valor);
      if (depois < antes) {
        // Queda de UMA leitura: página defasada do portal se a leitura seguinte desfaz (transitória),
        // ou ainda sem leitura seguinte (pendente). Medido em 22/11/2026: 10 de 10 quedas eram isto,
        // conferidas nas páginas guardadas (a mesma ideia em duas páginas da mesma coleta, uma montada
        // antes). Relatadas, sem alerta; a queda que persiste continua sendo violação.
        const seguinte = apoios[i + 1];
        const umaLeitura = apoios[i].leituras === 1;
        const tipo: Violacao["tipo"] = umaLeitura && !seguinte ? "pendente" : umaLeitura && Number(seguinte.valor) >= antes ? "transitoria" : "violacao";
        out.push({
          ...base, regra: "apoiosNaoDecrescem", tipo,
          detalhe: `${antes} (até ${apoios[i - 1].vistoUltimo.slice(0, 10)}) → ${depois} (${apoios[i].vistoPrimeiro.slice(0, 10)})`,
          paginas: [apoios[i - 1].shaUltimo, apoios[i].shaPrimeiro],
        });
      }
    }
  }
  return out;
}

export interface Conhecida {
  chave: string;
  motivo: string;
  /** Data (ISO) em que a explicação foi conferida na fonte. */
  conferidaEm: string;
}

/** Separa as violações em novas (derrubam o job) e conhecidas (só relatadas). */
export function separarConhecidas(vs: readonly Violacao[], conhecidas: readonly Conhecida[]): { novas: Violacao[]; conhecidas: Violacao[]; semAlerta: Violacao[] } {
  const ks = new Set(conhecidas.map((c) => c.chave));
  const novas: Violacao[] = [];
  const velhas: Violacao[] = [];
  const semAlerta: Violacao[] = [];
  for (const v of vs) (v.tipo !== "violacao" ? semAlerta : ks.has(chaveDaViolacao(v)) ? velhas : novas).push(v);
  return { novas, conhecidas: velhas, semAlerta };
}
